import {
  readRuleFixtures,
  type FixtureCase,
  type FixtureCoverage,
  type RuleFixtures,
} from "../fixtures";

/**
 * A runtime fixture case: a directory, whose path is the `root` the harness
 * hands the check.
 *
 * The case layout is every engine's now (see `rules/fixtures.ts`). It started
 * here: `executeRuntimeRule(root, rule)` already took a root and `check`
 * already passed the repository root, so a case directory is the same argument
 * with a smaller tree behind it.
 */
export type RuntimeFixtureCase = FixtureCase;

/** Which buckets a runtime rule populated. See {@link FixtureCoverage}. */
export type RuntimeFixtureCoverage = FixtureCoverage;

/** Every fixture case a runtime rule holds, with what the buckets cover. */
export type RuntimeFixtures = RuleFixtures;

/** Read a runtime rule's fixture cases from `tests/pass/` and `tests/fail/`. */
export async function readRuntimeFixtures(
  cwd: string,
  ruleId: string
): Promise<RuntimeFixtures> {
  return readRuleFixtures(cwd, "runtime", ruleId);
}
