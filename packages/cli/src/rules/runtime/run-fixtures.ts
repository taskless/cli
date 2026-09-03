import { describeCoverageShortfall } from "../fixtures";
import type { RuntimeRule } from "./discover";
import { executeRuntimeRuleDetailed } from "./harness";
import type { RuntimeRunOptions } from "./harness";
import type {
  RuntimeFixtureCase,
  RuntimeFixtureCoverage,
  RuntimeFixtures,
} from "./fixtures";

/** A case that reached the check but broke its bucket's expectation. */
export interface FixtureCheckFailure {
  /** The case directory's name, which is what an author has to go and edit. */
  name: string;
  message: string;
}

/**
 * What running a runtime rule's fixtures showed.
 *
 * Named after the Vale runner's fields on purpose: `missingFailures` and
 * `unexpectedFindings` mean the same thing one tier up, so a reader who knows
 * one runner knows this one. The two extra lists are D8's, and they exist
 * because "the check produced no findings" is three different situations that
 * an array of findings cannot tell apart.
 */
export interface RuntimeFixtureReport {
  passed: boolean;
  coverage: RuntimeFixtureCoverage;
  /** `fail/` cases where the check ran and reported nothing. */
  missingFailures: string[];
  /** `pass/` cases where the check ran and reported something. */
  unexpectedFindings: string[];
  /**
   * Cases whose narrow matched nothing, so `check.ts` was never invoked.
   *
   * A fixture defect in EITHER bucket. A `fail/` case here did not show the
   * rule stopped firing, it showed the fixture never reached the check; a
   * `pass/` case here looks like a clean pass and proves only that the narrow
   * did not match, so it cannot show the check stays quiet. Both point at the
   * fixture, which is the file the author can actually change.
   */
  neverInvoked: string[];
  /** Cases where the narrow or the check itself failed, rather than found nothing. */
  checkFailures: FixtureCheckFailure[];
}

/** `fail/case-1` — the bucket is half the identity of a case. */
function label(fixtureCase: RuntimeFixtureCase): string {
  return `${fixtureCase.bucket}/${fixtureCase.name}`;
}

/**
 * Run every fixture case a runtime rule holds, one case directory per run.
 *
 * The case directory IS the `root`, which is why this is a caller of
 * {@link executeRuntimeRuleDetailed} rather than a sibling of it: process
 * spawn, timeout, narrowing, capture discovery and the result mapping are the
 * ones `check` already proves on every authenticated scan, pointed at a smaller
 * tree. Nothing here re-runs the narrow or re-invokes the check.
 *
 * Cases run in sequence, matching `executeRuntimeRules`, so `tsx` worker
 * startup stays predictable.
 */
export async function runRuntimeFixtures(
  rule: RuntimeRule,
  fixtures: RuntimeFixtures,
  options: RuntimeRunOptions = {}
): Promise<RuntimeFixtureReport> {
  const missingFailures: string[] = [];
  const unexpectedFindings: string[] = [];
  const neverInvoked: string[] = [];
  const checkFailures: FixtureCheckFailure[] = [];

  for (const fixtureCase of fixtures.cases) {
    const execution = await executeRuntimeRuleDetailed(
      fixtureCase.root,
      rule,
      options
    );

    // Checked first, and separately from the findings. A throw and a timeout
    // both arrive as one error-severity finding, so reading the findings alone
    // would count a crashed check as a `fail/` case that fired correctly.
    if (execution.failure !== undefined) {
      checkFailures.push({
        name: label(fixtureCase),
        message: execution.failure,
      });
      continue;
    }

    if (!execution.invoked) {
      neverInvoked.push(label(fixtureCase));
      continue;
    }

    if (fixtureCase.bucket === "fail") {
      if (execution.findings.length === 0)
        missingFailures.push(label(fixtureCase));
    } else if (execution.findings.length > 0) {
      unexpectedFindings.push(label(fixtureCase));
    }
  }

  return {
    // Only `both` can pass, for `ValeFixtureCoverage`'s reason: a rule with one
    // bucket has proved half of what a rule claims, and a rule with neither has
    // proved nothing while exiting zero.
    passed:
      fixtures.coverage === "both" &&
      missingFailures.length === 0 &&
      unexpectedFindings.length === 0 &&
      neverInvoked.length === 0 &&
      checkFailures.length === 0,
    coverage: fixtures.coverage,
    missingFailures,
    unexpectedFindings,
    neverInvoked,
    checkFailures,
  };
}

/**
 * The report as the lines `test` prints under the rule.
 *
 * Each line names the case, because the case is the file the author edits. The
 * `neverInvoked` line says the check did not run rather than "expected a
 * finding, got none": the second is true and sends the author to `check.ts`,
 * which is not where the problem is.
 */
export function describeFixtureReport(
  ruleId: string,
  report: RuntimeFixtureReport
): string[] {
  const errors: string[] = [];

  // `/` because these buckets are directories, which is how the author will go
  // looking for them. `sg`'s are YAML keys and read `valid:`.
  const shortfall = describeCoverageShortfall(ruleId, report.coverage, "/");
  if (shortfall !== undefined) errors.push(shortfall);
  for (const name of report.missingFailures) {
    errors.push(`fail fixture did not fire: ${name}`);
  }
  for (const name of report.unexpectedFindings) {
    errors.push(`pass fixture wrongly fired: ${name}`);
  }
  for (const name of report.neverInvoked) {
    errors.push(
      `fixture case matched no captures, so check.ts never ran: ${name}. ` +
        `The case is the defect, not the check: add code the rule's captures match.`
    );
  }
  for (const failure of report.checkFailures) {
    errors.push(`check failed on ${failure.name}: ${failure.message}`);
  }

  return errors;
}
