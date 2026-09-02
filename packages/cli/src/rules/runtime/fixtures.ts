import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { isMissingDirectory } from "../errno";
import { ruleTestsDirectory } from "../engines";

/** The two buckets a fixture case can live in. */
export type FixtureBucket = "pass" | "fail";

/**
 * One fixture case: a DIRECTORY, whose path is the `root` the harness hands
 * the check.
 *
 * Vale's buckets hold documents; runtime's hold directories. That is not a
 * stylistic difference. `executeRuntimeRule(root, rule)` already takes a root
 * and `check` already passes the repository root, so a case directory is the
 * same argument with a smaller tree behind it. A runtime rule exists because
 * its evidence spans more than one file, so a layout allowing one file per
 * case could not express the rules this tier is for.
 */
export interface RuntimeFixtureCase {
  bucket: FixtureBucket;
  /** The case directory's own name, for messages. */
  name: string;
  /** Absolute path, and the `root` the check will be given. */
  root: string;
}

/**
 * Which buckets a rule actually populated.
 *
 * Four cases rather than a boolean, and the reasoning is `ValeFixtureCoverage`'s
 * because the mistake it corrects is the same one: `"none"` is an unwritten
 * rule, while `"pass-only"`/`"fail-only"` is a half-written one, which is the
 * more misleading of the two. A rule with only `fail/` cases has shown it fires
 * and not that it stays quiet; only `both` can reach a pass.
 */
export type RuntimeFixtureCoverage =
  | "both"
  | "pass-only"
  | "fail-only"
  | "none";

/** Classify a rule's buckets by how many cases each held. */
function coverageOf(
  passCount: number,
  failCount: number
): RuntimeFixtureCoverage {
  if (passCount > 0 && failCount > 0) return "both";
  if (passCount > 0) return "pass-only";
  if (failCount > 0) return "fail-only";
  return "none";
}

/**
 * A missing directory is an empty bucket; anything else rethrows.
 *
 * The buckets are read independently and this discrimination is why. Swallowing
 * an `EACCES` on `pass/` would yield `[]` while `fail/` still had cases, so the
 * rule would not look one-sided and could report a pass having never checked
 * the pass side at all. A permissions problem must not read as "no pass
 * fixtures were written".
 */
async function directoryEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }
}

/**
 * The cases in one bucket, one level deep.
 *
 * Every entry must be a directory, and a loose file is an error naming its own
 * path rather than an entry quietly skipped. The check is handed a root and
 * reads whatever it needs beneath it, so a file has no root to be: there is no
 * sensible reading of `pass/example.ts` that the harness could act on, and
 * ignoring it would leave an author with a fixture they wrote, that never ran,
 * and that nothing mentioned.
 */
async function bucketCases(
  cwd: string,
  ruleId: string,
  bucket: FixtureBucket
): Promise<RuntimeFixtureCase[]> {
  const directory = join(ruleTestsDirectory(cwd, "runtime", ruleId), bucket);
  const entries = await directoryEntries(directory);

  const loose = entries.find((entry) => !entry.isDirectory());
  if (loose !== undefined) {
    throw new Error(
      `A runtime fixture case is a directory: ${join(directory, loose.name)} ` +
        `is not one. The check is given the case directory as its root and ` +
        `reads the files it needs beneath it, so a bare file in ${bucket}/ ` +
        `has no root to be and would never run.`
    );
  }

  return entries.map((entry) => ({
    bucket,
    name: entry.name,
    root: join(directory, entry.name),
  }));
}

/** Every fixture case a runtime rule holds, with what the buckets cover. */
export interface RuntimeFixtures {
  cases: RuntimeFixtureCase[];
  coverage: RuntimeFixtureCoverage;
}

/**
 * Read a runtime rule's fixture cases from `.tests/pass/` and `.tests/fail/`.
 *
 * Reads the buckets independently rather than walking `.tests/` once, so an
 * unreadable bucket surfaces as itself instead of as an absence.
 */
export async function readRuntimeFixtures(
  cwd: string,
  ruleId: string
): Promise<RuntimeFixtures> {
  const [pass, fail] = await Promise.all([
    bucketCases(cwd, ruleId, "pass"),
    bucketCases(cwd, ruleId, "fail"),
  ]);

  return {
    cases: [...fail, ...pass],
    coverage: coverageOf(pass.length, fail.length),
  };
}
