import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parse, stringify } from "yaml";

import { ensureTasklessDirectory } from "../filesystem/directory";
import type { GeneratedRule, RuleMetadata } from "../api/rules";
import {
  ENGINE_LAYOUTS,
  astGrepRuleFileCandidates,
  astGrepRuleTestDirectories,
  resolveIngestEngine,
} from "./engines";
import { isValidRuleId } from "./validate-id";

/**
 * Write a generated rule's content into the engine directory its payload
 * identifies — `.taskless/sg/rules/{kebab-id}.yml` for the engine-less payloads
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
  await ensureTasklessDirectory(cwd);
  const directory = join(
    cwd,
    ".taskless",
    ENGINE_LAYOUTS[engine].rulesDirectory
  );
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${rule.id}.yml`);
  await writeFile(filePath, stringify(rule.content, { lineWidth: 0 }), "utf8");
  return filePath;
}

/**
 * Write a rule's test cases to that engine's rule-tests directory —
 * `.taskless/sg/rule-tests/{kebab-id}-{timestamp}-test.yml` by default.
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
  const directory = join(
    cwd,
    ".taskless",
    ENGINE_LAYOUTS[engine].ruleTestsDirectory
  );
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
  // Delete from every layout the CLI dispatches, so a rule that still lives at
  // the legacy path is removed rather than reported as missing.
  let ruleExisted = false;
  for (const ruleFilePath of astGrepRuleFileCandidates(cwd, id)) {
    try {
      await rm(ruleFilePath);
      ruleExisted = true;
    } catch {
      // Not in this layout — try the next.
    }
  }
  if (!ruleExisted) return false;

  // Remove matching test files
  for (const testDirectory of astGrepRuleTestDirectories(cwd)) {
    try {
      const entries = await readdir(testDirectory);
      const matchingTests = entries.filter(
        (f) => f.startsWith(`${id}-`) && f.endsWith("-test.yml")
      );
      await Promise.all(
        matchingTests.map((f) =>
          rm(join(testDirectory, f)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
              console.error(
                `Warning: failed to remove test file ${f}: ${error.message}`
              );
            }
          })
        )
      );
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
          `Warning: failed to clean up test files: ${(error as Error).message}`
        );
      }
    }
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

  return ruleExisted;
}
