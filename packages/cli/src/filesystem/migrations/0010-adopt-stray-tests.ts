import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { pathExists } from "../../rules/reconcile-marker";
import {
  ENGINES,
  RULES_DIRECTORY,
  RULE_TESTS_DIRECTORY,
  type EngineName,
} from "../../rules/layout";
import type { Migration } from "../types";

/**
 * Move test files `0005` left behind into the rule they belong to.
 *
 * `0005` filed an ast-grep test by parsing its name as `<id>-YYYYMMDD-test.yml`
 * and taking everything before the date as the rule id. An older CLI named
 * both rule and test after a full timestamp, `<name>-YYYYMMDD-HHMMSS`, and its
 * test was `<id>-test.yml` with no date of its own, so the pattern never
 * matched. The file stayed in `.taskless/sg/rule-tests/`, which was then kept
 * because it was not empty. Measured on a real schema-0 project migrated by
 * 0.12.0: the rule moved and its only test did not, so the rule had nothing
 * exercising it and the stray directory outlived the layout it belonged to.
 *
 * **A new migration, not a fix to `0005`.** A project already past version 5
 * never re-runs it, so only a new version reaches the projects that already
 * carry the stray files.
 *
 * **Matched against the rules that exist, not parsed.** For a test named
 * `<stem>-test.yml`, the rule is the LONGEST rule id `R` under the same engine
 * where `<stem>` is `R` or starts with `R-`. That covers both shapes (`R-test`
 * and `R-YYYYMMDD-test`) without a second pattern that could be wrong the same
 * way the first was. A directory entry (Vale and runtime keep one per rule) is
 * matched by exact name. Anything that matches no rule is left where it is,
 * never guessed at and never deleted, and so is its directory.
 *
 * Never overwrites: a destination that already exists keeps its bytes.
 */

/** Where `0004` kept tests, relative to `.taskless/`. */
const PRIOR_TESTS: Record<EngineName, string> = {
  sg: join("sg", "rule-tests"),
  vale: join("vale", "rule-tests"),
  runtime: join("runtime", "rule-tests"),
};

async function directoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The rule a flat test file belongs to, or `undefined`. Exported for tests. */
export function ruleForTestFile(
  fileName: string,
  ruleIds: readonly string[]
): string | undefined {
  const stem = /^(?<stem>.+)-test\.ya?ml$/.exec(fileName)?.groups?.stem;
  if (stem === undefined) return undefined;
  return ruleIds
    .filter((id) => stem === id || stem.startsWith(`${id}-`))
    .toSorted((a, b) => b.length - a.length)[0];
}

/** Remove `path` if it holds nothing but a `.gitkeep`. */
async function pruneIfEmpty(path: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(path);
  } catch {
    return;
  }
  if (entries.every((name) => name === ".gitkeep")) {
    await rm(path, { recursive: true, force: true });
  }
}

const migration: Migration = async (directory) => {
  for (const engine of ENGINES) {
    const from = join(directory, PRIOR_TESTS[engine]);
    let entries;
    try {
      entries = await readdir(from, { withFileTypes: true });
    } catch {
      continue;
    }
    const ruleIds = await directoryNames(
      join(directory, RULES_DIRECTORY, engine)
    );

    for (const entry of entries) {
      if (entry.name === ".gitkeep") continue;
      const ruleId = entry.isDirectory()
        ? ruleIds.includes(entry.name)
          ? entry.name
          : undefined
        : ruleForTestFile(entry.name, ruleIds);
      if (ruleId === undefined) continue;

      const testsDirectory = join(
        directory,
        RULES_DIRECTORY,
        engine,
        ruleId,
        RULE_TESTS_DIRECTORY
      );
      if (entry.isDirectory()) {
        // A per-rule test directory becomes the rule's `.tests/`, unless it
        // already has one, in which case its entries join it one by one.
        if (!(await pathExists(testsDirectory))) {
          await rename(join(from, entry.name), testsDirectory);
          continue;
        }
        for (const child of await readdir(join(from, entry.name))) {
          const destination = join(testsDirectory, child);
          if (await pathExists(destination)) continue;
          await rename(join(from, entry.name, child), destination);
        }
        await pruneIfEmpty(join(from, entry.name));
        continue;
      }

      const destination = join(testsDirectory, entry.name);
      if (await pathExists(destination)) continue;
      // `.tests/` may not exist yet for a rule that never had one.
      await mkdir(testsDirectory, { recursive: true });
      await rename(join(from, entry.name), destination);
    }

    await pruneIfEmpty(from);
    await pruneIfEmpty(join(directory, engine));
  }
};

export default migration;
