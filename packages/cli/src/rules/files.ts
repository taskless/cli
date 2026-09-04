import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parse, stringify } from "yaml";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { isSingleContentRule } from "../api/rules";
import type { GeneratedRule, RuleMetadata } from "../api/rules";
import {
  resolveIngestEngine,
  ruleDirectory,
  ruleFilePath,
  ruleTestsDirectory,
  findRuleEngine,
} from "./engines";
import { isValidRuleId } from "./validate-id";
import {
  assessDelivery,
  deliveredFiles,
  describeMissingFixtures,
  writeDeliveredFileSet,
} from "./deliver";

/**
 * Write a generated rule's content into its own rule directory —
 * `.taskless/rules/sg/{kebab-id}/{kebab-id}.yml` for the engine-less payloads
 * the API delivers today (see {@link resolveIngestEngine}).
 *
 * `onWarning` receives anything worth saying about a delivery that was still
 * written. Optional, and a caller that omits it loses the message rather than
 * the write — see {@link describeMissingFixtures} for why a missing fixture is
 * reported this way instead of refused.
 */
export async function writeRuleFile(
  cwd: string,
  rule: GeneratedRule,
  onWarning?: (message: string) => void
): Promise<string> {
  if (!isValidRuleId(rule.id)) {
    throw new Error(`Invalid rule ID "${rule.id}"`);
  }
  // Resolve the engine before touching the filesystem: an unrecognized engine
  // must write nothing at all.
  const engine = resolveIngestEngine(rule);

  // A file set and a single `content` are mutually exclusive, per the contract.
  // Carrying both means the service is unsure what it sent, and picking one
  // would write a rule nobody described.
  const delivered = deliveredFiles(rule);
  if (delivered.kind === "malformed") {
    throw new Error(`Rule "${rule.id}" ${delivered.reason}.`);
  }
  if (delivered.kind === "present") {
    // The published union makes this unrepresentable, and the check stays.
    // The type states what the service PROMISES; this defends against it
    // breaking that promise, which is the only reason the client validates a
    // payload at all.
    if ((rule as { content?: unknown }).content !== undefined) {
      throw new Error(
        `Rule "${rule.id}" carries both \`files\` and \`content\`; they are mutually exclusive.`
      );
    }
    // Assessed as a unit before anything is written. A half-written rule
    // directory verifies as a broken rule two steps from the cause, and the
    // delivery that produced it has already reported success.
    const assessment = assessDelivery(cwd, engine, rule.id, delivered.files);
    if (!assessment.ok) {
      throw new Error(`Rule "${rule.id}" ${assessment.reason}.`);
    }
    await ensureTasklessDirectory(cwd);
    await mkdir(ruleDirectory(cwd, engine, rule.id), { recursive: true });
    // The set is the directory, not an overlay on it: anything already there
    // that the set does not name is removed, `.tests/` excepted. The same for
    // every caller of this function — see {@link writeDeliveredFileSet} for why
    // repair is not special-cased. The single-content path below has no set to
    // be authoritative about and keeps overwriting one file.
    await writeDeliveredFileSet(cwd, engine, rule.id, assessment);
    // AFTER the write, deliberately. This is an observation about a rule that
    // is now on disk, and warning first would read as a reason it was refused.
    const missingFixtures = describeMissingFixtures(assessment.files);
    if (missingFixtures !== undefined) {
      onWarning?.(`Rule "${rule.id}" ${missingFixtures}.`);
    }
    // The rule file, so the caller's contract ("where did this rule land")
    // is unchanged whichever envelope delivered it.
    return ruleFilePath(cwd, engine, rule.id);
  }

  // `files` is absent past the branch above, so this is the single-content
  // envelope, and what remains is whether its `content` can actually be
  // written. Checked BEFORE anything is created.
  //
  // The test is "a usable object", not "not undefined". `yaml` does not throw
  // on a value it cannot make a document of, it renders one: `undefined`
  // becomes the string "undefined" and `null` becomes the string "null", so
  // either way the rule file is created and its entire contents are that word
  // — a malformed rule discovered two steps from the cause.
  //
  // Note this deliberately asks a different question from the mutual-exclusion
  // check above, which treats ANY present `content` (including `null`) as the
  // service having sent both envelopes. That one is about what the payload
  // claims; this one is about what can be written. Reusing a single predicate
  // for both would make one of them wrong.
  if (!isUsableContent(rule)) {
    throw new Error(
      `Rule "${rule.id}" carries no usable \`content\`, and no \`files\`.`
    );
  }
  await ensureTasklessDirectory(cwd);
  await mkdir(ruleDirectory(cwd, engine, rule.id), { recursive: true });
  const filePath = ruleFilePath(cwd, engine, rule.id);
  await writeFile(filePath, stringify(rule.content, { lineWidth: 0 }), "utf8");
  return filePath;
}

/**
 * Whether a rule's `content` is something a rule file can be written from.
 *
 * A rule body is a YAML mapping. `undefined`, `null` and any primitive are all
 * values `yaml` will happily render as a scalar document, which is how a rule
 * file containing nothing but `null` reaches a developer's disk.
 */
function isUsableContent(
  rule: GeneratedRule
): rule is GeneratedRule & { content: Record<string, unknown> } {
  const content = (rule as { content?: unknown }).content;
  return typeof content === "object" && content !== null;
}

/**
 * Write a rule's test cases inside its own rule directory —
 * `.taskless/rules/sg/{kebab-id}/.tests/{kebab-id}-{timestamp}-test.yml`.
 */
export async function writeRuleTestFile(
  cwd: string,
  rule: GeneratedRule,
  timestamp: string
): Promise<string> {
  if (!isValidRuleId(rule.id)) {
    throw new Error(`Invalid rule ID "${rule.id}"`);
  }
  const engine = resolveIngestEngine(rule);
  await ensureTasklessDirectory(cwd);
  const directory = ruleTestsDirectory(cwd, engine, rule.id);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${rule.id}-${timestamp}-test.yml`);
  // Only the single-content envelope carries `tests`; a file set delivers its
  // fixtures as ordinary files under `.tests/`.
  const tests = isSingleContentRule(rule) ? rule.tests : undefined;
  const content = {
    id: rule.id,
    valid: tests?.valid ?? [],
    invalid: tests?.invalid ?? [],
  };
  await writeFile(filePath, stringify(content, { lineWidth: 0 }), "utf8");
  return filePath;
}

/** Write sidecar metadata files to .taskless/rule-metadata/{key}.yml */
export async function writeRuleMetaFiles(
  cwd: string,
  meta: RuleMetadata
): Promise<string[]> {
  const directory = join(cwd, ".taskless", "rule-metadata");
  await mkdir(directory, { recursive: true });
  const writtenFiles: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    const sanitized = basename(key);
    const filePath = resolve(directory, `${sanitized}.yml`);
    if (!filePath.startsWith(directory)) {
      continue;
    }
    await writeFile(filePath, stringify(value, { lineWidth: 0 }), "utf8");
    writtenFiles.push(filePath);
  }
  return writtenFiles;
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

/** Delete a rule file and any matching test files. Returns whether the rule file existed. */
export async function deleteRuleFiles(
  cwd: string,
  id: string
): Promise<boolean> {
  if (!isValidRuleId(id)) {
    return false;
  }
  // A rule is one directory, so deleting it is removing that directory. Its
  // tests live inside, which is the point of the layout: there is no second
  // place to remember, and no way to leave a rule half-deleted.
  //
  // The engine is RESOLVED, never assumed. This hardcoded `sg`, which was
  // invisible while ast-grep was the only engine a rule could be delivered
  // for: a vale or runtime rule could be written and then not removed, and
  // `delete` reported "not found" for a rule plainly on disk.
  const engine = await findRuleEngine(cwd, id);
  if (engine === undefined) return false;
  const directory = ruleDirectory(cwd, engine, id);
  try {
    await rm(directory, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
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

  return true;
}
