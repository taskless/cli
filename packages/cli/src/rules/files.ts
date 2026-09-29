import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { CLIError } from "../util/cli-error";
import type { ServedFileSet } from "../api/v2";
import { ruleDirectory, ruleFilePath, findRuleEngines } from "./engines";
import { isKnownEngine, type EngineName } from "./layout";
import { describeRuleIdCollision, findRuleIdCollision } from "./id-uniqueness";
import { isValidRuleId } from "./validate-id";
import {
  assessDelivery,
  describeMissingFixtures,
  writeDeliveredFileSet,
} from "./deliver";

/**
 * Write a rule served by the v2 API into `.taskless/rules/<engine>/<id>/`.
 *
 * The caller must already have passed the set through `verifyServedRule`:
 * this function checks that the set is a complete, writable rule, and trusts
 * that its bytes are the issued ones. The engine is the set's own `engine`,
 * which v2 always sends, so nothing is inferred from the payload's shape.
 *
 * The set IS the directory: whatever is on disk that the set does not name is
 * removed, `.tests/` included, since v2 serves a rule's fixtures with it.
 */
export async function writeServedRule(
  cwd: string,
  fileSet: ServedFileSet,
  onWarning?: (message: string) => void
): Promise<string> {
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
  const assessment = assessDelivery(cwd, engine, fileSet.id, fileSet.files);
  if (!assessment.ok) {
    throw new Error(`Rule "${fileSet.id}" ${assessment.reason}.`);
  }
  await ensureTasklessDirectory(cwd);
  await mkdir(ruleDirectory(cwd, engine, fileSet.id), { recursive: true });
  await writeDeliveredFileSet(cwd, engine, fileSet.id, assessment);
  // After the write, and asked of the set alone: the purge made the directory
  // equal to the set, so "the delivery carried no fixtures" and "the rule has
  // none" are now the same statement.
  const missingFixtures = describeMissingFixtures(assessment.files);
  if (missingFixtures !== undefined) {
    onWarning?.(`Rule "${fileSet.id}" ${missingFixtures}.`);
  }
  await warnOnIdCollision(cwd, fileSet.id, onWarning);
  return ruleFilePath(cwd, engine, fileSet.id);
}

/**
 * Say so when the rule just written shares its id with another engine's.
 *
 * A WARNING, never a refusal, and that is the whole design. `rule restore`
 * writes through here, so refusing would brick recovery for both colliding
 * rules — strictly worse than the silence it replaces. The failure belongs in
 * `verify` (and in `check`, which refuses a logged-in run over it), which is
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
    `${describeRuleIdCollision(cwd, collision)} \`verify\` fails both until one is renamed.`
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
 * said it went fine (#264). The path-addressed commands, `verify` and `test`,
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
