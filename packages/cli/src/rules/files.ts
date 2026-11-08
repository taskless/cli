import { mkdir, mkdtemp, readFile, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parse } from "yaml";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { CLIError } from "../util/cli-error";
import type { ServedFileSet } from "../api/v2";
import { ruleDirectory, ruleFilePath, findRuleEngines } from "./engines";
import { convertLegacyFileSet } from "./fixture-convert";
import {
  isKnownEngine,
  LEGACY_RULE_TESTS_DIRECTORY,
  RULE_TESTS_DIRECTORY,
  TASKLESS_DIRECTORY,
  type EngineName,
} from "./layout";
import { describeRuleIdCollision, findRuleIdCollision } from "./id-uniqueness";
import { isMissingDirectory } from "./errno";
import { isValidRuleId } from "./validate-id";
import {
  assertRuleDirectoryIsNotALink,
  assessDelivery,
  describeMissingFixtures,
  writeDeliveredFileSet,
  type DeliveryAssessment,
} from "./deliver";

/** A served rule that passed every check and only remains to be written. */
export interface PreparedRule {
  id: string;
  engine: EngineName;
  assessment: Extract<DeliveryAssessment, { ok: true }>;
}

/**
 * Check that a rule served by the v2 API is a complete, writable rule, writing
 * nothing. Throws the reason it is not.
 *
 * The caller must already have passed the set through `verifyServedRule`:
 * this function checks that the set is a complete, writable rule, and trusts
 * that its bytes are the issued ones. The engine is the set's own `engine`,
 * which v2 always sends, so nothing is inferred from the payload's shape.
 *
 * A set whose fixtures are in the legacy `.tests/` layout is migrated just in
 * time, before it is assessed, by the converter migration `12` uses. That is a
 * permanent reading of the old format, so the CLI never depends on the service
 * moving: it never writes a layout its own `verify` does not read. Fixtures
 * carry no signature, and `verifyServedRule` has already checked every signed
 * file, so no signed byte changes here.
 *
 * Separate from {@link writePreparedRule} so a caller delivering several rules
 * can refuse any one of them before writing the first.
 */
export function prepareServedRule(
  cwd: string,
  fileSet: ServedFileSet,
  onWarning?: (message: string) => void
): PreparedRule {
  if (!isValidRuleId(fileSet.id)) {
    throw new Error(`Invalid rule ID "${fileSet.id}"`);
  }
  const engine: string = fileSet.engine;
  if (!isKnownEngine(engine)) {
    // A CLIError, unreported: nothing has printed yet, so the top-level
    // handler is what stands between a newer engine and a silent exit 0.
    throw new CLIError(
      `Rule "${fileSet.id}" is a ${engine} rule, which this version of the CLI does not support. Upgrade the Taskless CLI and try again.`,
      "RULE_UNSUPPORTED"
    );
  }
  const migrated = convertLegacyFileSet(
    engine,
    fileSet.id,
    fileSet.files,
    LEGACY_RULE_TESTS_DIRECTORY,
    RULE_TESTS_DIRECTORY
  );
  for (const line of migrated.unconverted) {
    onWarning?.(
      `Rule "${fileSet.id}" was served a fixture in the old ` +
        `${LEGACY_RULE_TESTS_DIRECTORY}/ layout that could not be converted ` +
        `into a case, so it was written under ${RULE_TESTS_DIRECTORY}/ as it ` +
        `was, where verify will name it, or dropped when it is an \`sg test\` ` +
        `snapshot: ${line}.`
    );
  }
  const assessment = assessDelivery(cwd, engine, fileSet.id, migrated.files);
  if (!assessment.ok) {
    throw new Error(`Rule "${fileSet.id}" ${assessment.reason}.`);
  }
  return { id: fileSet.id, engine, assessment };
}

/**
 * Write a rule {@link prepareServedRule} accepted into
 * `.taskless/rules/<engine>/<id>/`, and return its rule file.
 *
 * The set IS the directory: whatever is on disk that the set does not name is
 * removed, `tests/` included, since v2 serves a rule's fixtures with it.
 */
export async function writePreparedRule(
  cwd: string,
  prepared: PreparedRule,
  onWarning?: (message: string) => void
): Promise<string> {
  const { id, engine, assessment } = prepared;
  await ensureTasklessDirectory(cwd);
  await mkdir(ruleDirectory(cwd, engine, id), { recursive: true });
  await writeDeliveredFileSet(cwd, engine, id, assessment);
  // After the write, and asked of the set alone: the purge made the directory
  // equal to the set, so "the delivery carried no fixtures" and "the rule has
  // none" are now the same statement.
  const missingFixtures = describeMissingFixtures(assessment.files);
  if (missingFixtures !== undefined) {
    onWarning?.(`Rule "${id}" ${missingFixtures}.`);
  }
  await warnOnIdCollision(cwd, id, onWarning);
  return ruleFilePath(cwd, engine, id);
}

/**
 * Where a multi-rule delivery is assembled, inside `.taskless/` so that every
 * rename out of it stays on one filesystem: a rename across devices is a copy,
 * which is neither atomic nor guaranteed to succeed.
 */
const STAGING_PREFIX = ".tmp-delivery-";

/** One rule's move into `.taskless/rules/`, recorded so it can be undone. */
interface CommitStep {
  id: string;
  /** The rule directory being replaced or created. */
  target: string;
  /** Where the version already at `target` was moved, when there was one. */
  previous?: string;
  /** The topmost directory `mkdir` created above `target`, when it made one. */
  createdParent?: string;
  /** Set once the staged rule is at `target`. */
  committed: boolean;
}

/**
 * Write several rules {@link prepareServedRule} accepted, so that an IO
 * failure part-way leaves `.taskless/rules/` as it was. `onWarning` names the
 * rule a warning is about by its index in `rules`, and omits the index for a
 * warning about the delivery as a whole.
 *
 * Two phases:
 *
 * 1. **Stage.** Every rule is written in full into a fresh directory under
 *    `.taskless/`, by the same {@link writeDeliveredFileSet} a single rule
 *    goes through, so a full disk or an unwritable file stops here, before
 *    anything under `.taskless/rules/` has moved.
 * 2. **Commit.** Each rule is moved into place with `rename`: the version
 *    already there (if any) is renamed aside into the staging directory, then
 *    the staged directory is renamed onto the rule's path. If any rename
 *    fails, the rules already moved are undone in reverse order: the new
 *    directory is removed and the old one renamed back, and directories the
 *    commit created are removed again.
 *
 * WHAT IS AND IS NOT ATOMIC. Each rename is atomic, on one filesystem; the
 * sequence of them is not. A process killed outright (SIGKILL, a power loss)
 * between two renames leaves `.taskless/rules/` holding some rules at their
 * new version and the rest at their old one, possibly with one rule absent
 * for the instant between its two renames. Every replaced version is then
 * still on disk, under `.taskless/.tmp-delivery-*`, but nothing restores it
 * automatically. No renames are fsynced, so after a power loss the order in
 * which they reached the disk is up to the filesystem. Rollback can itself
 * fail (a permission changed underneath it, say), and then the staging
 * directory is KEPT rather than removed and the error names what is where, so
 * the replaced version is never deleted while it is the only copy.
 *
 * The rule directory being a symlink is refused before anything is staged,
 * as {@link writeDeliveredFileSet} refuses it: renaming the link aside would
 * otherwise orphan whatever a developer had pointed it at.
 */
export async function writePreparedRules(
  cwd: string,
  rules: readonly PreparedRule[],
  onWarning?: (message: string, index?: number) => void
): Promise<void> {
  await ensureTasklessDirectory(cwd);
  const staging = await mkdtemp(join(cwd, TASKLESS_DIRECTORY, STAGING_PREFIX));
  // The rule being staged, then the steps of the commit: between them, the
  // rule a failure happened on.
  let current: string | undefined;
  const steps: CommitStep[] = [];
  try {
    for (const rule of rules) {
      current = rule.id;
      await assertRuleDirectoryIsNotALink(
        ruleDirectory(cwd, rule.engine, rule.id)
      );
      // The staging directory stands in for the project root, so the staged
      // copy lands at the same relative path it will occupy for real.
      await writeDeliveredFileSet(
        staging,
        rule.engine,
        rule.id,
        rule.assessment
      );
    }
    current = undefined;
    await commitStaged(cwd, staging, rules, steps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof RollbackIncompleteError) {
      // The staging directory holds the only copy of a replaced version.
      throw new Error(
        `${reason} The staging directory ${staging} was kept, so nothing ` +
          `in it is lost; move what it names back, then delete it.`
      );
    }
    const unremoved = await removeStaging(staging);
    const failed = current ?? steps.at(-1)?.id;
    throw new Error(
      `${failed === undefined ? "The rules" : `Rule "${failed}"`} could ` +
        `not be written (${reason}). Every rule already moved into place was ` +
        `rolled back, so .taskless/rules/ is as it was.` +
        (unremoved === undefined ? "" : ` ${unremoved}`)
    );
  }

  const unremoved = await removeStaging(staging);
  if (unremoved !== undefined) onWarning?.(unremoved);

  // After the commit, and asked of the real tree, as `writePreparedRule` asks
  // them: these are observations about rules that are now on disk.
  if (onWarning === undefined) return;
  for (const [index, { id, assessment }] of rules.entries()) {
    const warn = (message: string): void => {
      onWarning(message, index);
    };
    const missingFixtures = describeMissingFixtures(assessment.files);
    if (missingFixtures !== undefined) {
      warn(`Rule "${id}" ${missingFixtures}.`);
    }
    await warnOnIdCollision(cwd, id, warn);
  }
}

/**
 * Move every staged rule into `.taskless/rules/`, recording each move in
 * `steps`, and undo the ones already made if any move fails. Throws the
 * failure once the undo is complete, or {@link RollbackIncompleteError} when
 * the undo itself could not finish.
 */
async function commitStaged(
  cwd: string,
  staging: string,
  rules: readonly PreparedRule[],
  steps: CommitStep[]
): Promise<void> {
  const replaced = join(staging, "replaced");
  await mkdir(replaced);
  try {
    for (const [index, rule] of rules.entries()) {
      const step: CommitStep = {
        id: rule.id,
        target: ruleDirectory(cwd, rule.engine, rule.id),
        committed: false,
      };
      // Recorded before the first rename, so a failure on either rename of
      // this rule is undone along with every rule before it.
      steps.push(step);
      const previous = join(replaced, String(index));
      try {
        await rename(step.target, previous);
        step.previous = previous;
      } catch (error) {
        // Nothing there yet is the ordinary case for a new rule.
        if (!isMissingDirectory(error)) throw error;
      }
      step.createdParent = await mkdir(dirname(step.target), {
        recursive: true,
      });
      await rename(ruleDirectory(staging, rule.engine, rule.id), step.target);
      step.committed = true;
    }
  } catch (error) {
    const stranded = await rollBack(steps);
    if (stranded.length > 0) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RollbackIncompleteError(reason, stranded);
    }
    throw error;
  }
}

/**
 * Undo {@link commitStaged}'s steps, last first, and return a description of
 * each one that could not be undone. Every step is attempted even after one
 * fails, so as much as possible is put back.
 */
async function rollBack(steps: readonly CommitStep[]): Promise<string[]> {
  const stranded: string[] = [];
  for (const step of steps.toReversed()) {
    try {
      if (step.committed) {
        await rm(step.target, { recursive: true, force: true });
      }
      if (step.createdParent !== undefined) {
        await removeCreatedParents(step.target, step.createdParent);
      }
      if (step.previous !== undefined) {
        await rename(step.previous, step.target);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      stranded.push(
        step.previous === undefined
          ? `rule "${step.id}" may still be at ${step.target} (${code})`
          : `the previous version of rule "${step.id}" is at ${step.previous}, not ${step.target} (${code})`
      );
    }
  }
  return stranded;
}

/**
 * Remove the directories `mkdir` created for a rule, deepest first, stopping
 * at the topmost one it created. `rmdir` rather than a recursive `rm`, so a
 * directory something else has since written into is refused, never emptied.
 */
async function removeCreatedParents(
  target: string,
  createdParent: string
): Promise<void> {
  for (let directory = dirname(target); ; directory = dirname(directory)) {
    await rmdir(directory);
    if (directory === createdParent || dirname(directory) === directory) {
      return;
    }
  }
}

/** Remove the staging directory, returning a warning when it could not be. */
async function removeStaging(staging: string): Promise<string | undefined> {
  try {
    await rm(staging, { recursive: true, force: true });
    return undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return `The staging directory ${staging} could not be removed (${code}); it holds nothing still in use and can be deleted.`;
  }
}

/** A failed commit whose undo could not put everything back. */
class RollbackIncompleteError extends Error {
  constructor(reason: string, stranded: readonly string[]) {
    super(
      `The rules could not be written (${reason}), and rolling back the ` +
        `rules already moved into place did not finish: ${stranded.join("; ")}.`
    );
    this.name = "RollbackIncompleteError";
  }
}

/**
 * Check, then write, one rule served by the v2 API:
 * {@link prepareServedRule} followed by {@link writePreparedRule}. For a
 * caller delivering a single rule, where checking first and writing second is
 * already all-or-nothing.
 */
export async function writeServedRule(
  cwd: string,
  fileSet: ServedFileSet,
  onWarning?: (message: string) => void
): Promise<string> {
  const prepared = prepareServedRule(cwd, fileSet, onWarning);
  return writePreparedRule(cwd, prepared, onWarning);
}

/**
 * Say so when the rule just written shares its id with another engine's.
 *
 * A WARNING, never a refusal, and that is the whole design. `rule restore`
 * writes through here, so refusing would brick recovery for both colliding
 * rules — strictly worse than the silence it replaces. The failure belongs in
 * `validate` (and in `check`, which refuses a logged-in run over it), which is
 * what the message points at.
 *
 * After the write, like the fixtures warning above it: this is an observation
 * about a rule that is now on disk, and warning first would read as a reason
 * it was refused.
 */
async function warnOnIdCollision(
  cwd: string,
  ruleId: string,
  onWarning?: (message: string) => void
): Promise<void> {
  if (onWarning === undefined) return;
  const collision = await findRuleIdCollision(cwd, ruleId);
  if (collision === undefined) return;
  onWarning(
    `${describeRuleIdCollision(cwd, collision)} \`validate\` fails both until one is renamed.`
  );
}

/** Read a rule's sidecar metadata from .taskless/rule-metadata/{id}.yml. Returns null if not found. */
export async function readRuleMetaFile(
  cwd: string,
  id: string
): Promise<Record<string, unknown> | null> {
  if (!isValidRuleId(id)) {
    return null;
  }
  const filePath = join(cwd, ".taskless", "rule-metadata", `${id}.yml`);
  try {
    const content = await readFile(filePath, "utf8");
    return parse(content) as Record<string, unknown>;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * What {@link deleteRuleFiles} did, and why.
 *
 * Three outcomes rather than a boolean, because "deleted" and "not found" are
 * not the only answers an id-addressed command can honestly give. An id does
 * not carry its engine and nothing makes one unique across engines, so an id
 * can name two rules; a boolean forced that case to be reported as one of the
 * two it is not, and `true` is the worse of the two to pick.
 */
export type DeleteRuleOutcome =
  | { outcome: "deleted"; engine: EngineName }
  | { outcome: "not-found" }
  | { outcome: "ambiguous"; engines: EngineName[]; paths: string[] };

/**
 * Delete a rule directory, and the metadata sidecar that goes with it.
 *
 * REFUSES WHEN THE ID IS AMBIGUOUS rather than picking one. Two engines can
 * hold the same id, and this used to take the first hit in {@link ENGINES}
 * order, delete it, and return `true`: the caller asked to delete a rule, a
 * different rule than they may have meant was deleted, and the return value
 * said it went fine (#264). The path-addressed commands, `validate` and `verify`,
 * removed this error case by not having an id to be ambiguous; `delete` still
 * takes an id, so it has to report the ambiguity instead of guessing at it.
 */
export async function deleteRuleFiles(
  cwd: string,
  id: string
): Promise<DeleteRuleOutcome> {
  if (!isValidRuleId(id)) {
    return { outcome: "not-found" };
  }
  // A rule is one directory, so deleting it is removing that directory. Its
  // tests live inside, which is the point of the layout: there is no second
  // place to remember, and no way to leave a rule half-deleted.
  //
  // The engine is RESOLVED, never assumed. This hardcoded `sg`, which was
  // invisible while ast-grep was the only engine a rule could be delivered
  // for: a vale or runtime rule could be written and then not removed, and
  // `delete` reported "not found" for a rule plainly on disk.
  // The scan and the `rm` below are not atomic, and that is accepted rather
  // than overlooked. A second engine's directory for this id could appear
  // between them, and the delete would then proceed on a resolution that has
  // just gone stale. Closing it would need a lock over `.taskless/rules/`,
  // which is a large mechanism for a local single-user filesystem operation
  // that no CLI command runs concurrently with itself. The window is narrow
  // and the cost of the fix is not.
  //
  // Destructured rather than indexed so `engine` narrows to a single engine
  // for the rest of the function: `engines[0]` is `EngineName | undefined`
  // under `noUncheckedIndexedAccess`, and asserting it away here would be
  // asserting exactly the thing this function exists to stop assuming.
  const [engine, ...rest] = await findRuleEngines(cwd, id);
  if (engine === undefined) return { outcome: "not-found" };
  if (rest.length > 0) {
    const engines = [engine, ...rest];
    return {
      outcome: "ambiguous",
      engines,
      paths: engines.map((candidate) => ruleDirectory(cwd, candidate, id)),
    };
  }
  const directory = ruleDirectory(cwd, engine, id);
  try {
    await rm(directory, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { outcome: "not-found" };
    throw error;
  }

  // Remove matching metadata file
  const metaDirectory = join(cwd, ".taskless", "rule-metadata");
  try {
    await rm(join(metaDirectory, `${id}.yml`));
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      console.error(
        `Warning: failed to remove metadata file: ${(error as Error).message}`
      );
    }
  }

  return { outcome: "deleted", engine };
}
