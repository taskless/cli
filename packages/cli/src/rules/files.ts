import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parse, stringify } from "yaml";

import { ensureTasklessDirectory } from "../filesystem/directory";
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
  writeDeliveredFileSet,
} from "./deliver";

/**
 * Write a generated rule's content into its own rule directory —
 * `.taskless/rules/sg/{kebab-id}/{kebab-id}.yml` for the engine-less payloads
 * the API delivers today (see {@link resolveIngestEngine}).
 */
export async function writeRuleFile(
  cwd: string,
  rule: GeneratedRule
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
  const files = deliveredFiles(rule);
  if (files !== undefined) {
    if (rule.content !== undefined) {
      throw new Error(
        `Rule "${rule.id}" carries both \`files\` and \`content\`; they are mutually exclusive.`
      );
    }
    // Assessed as a unit before anything is written. A half-written rule
    // directory verifies as a broken rule two steps from the cause, and the
    // delivery that produced it has already reported success.
    const assessment = assessDelivery(cwd, engine, rule.id, files);
    if (!assessment.ok) {
      throw new Error(`Rule "${rule.id}" ${assessment.reason}.`);
    }
    await ensureTasklessDirectory(cwd);
    await mkdir(ruleDirectory(cwd, engine, rule.id), { recursive: true });
    await writeDeliveredFileSet(cwd, engine, rule.id, assessment);
    // The rule file, so the caller's contract ("where did this rule land")
    // is unchanged whichever envelope delivered it.
    return ruleFilePath(cwd, engine, rule.id);
  }

  await ensureTasklessDirectory(cwd);
  await mkdir(ruleDirectory(cwd, engine, rule.id), { recursive: true });
  const filePath = ruleFilePath(cwd, engine, rule.id);
  await writeFile(filePath, stringify(rule.content, { lineWidth: 0 }), "utf8");
  return filePath;
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
  const content = {
    id: rule.id,
    valid: rule.tests?.valid ?? [],
    invalid: rule.tests?.invalid ?? [],
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
