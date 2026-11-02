import {
  caseResult,
  describeCoverageShortfall,
  type FixtureCaseResult,
  type FixtureFinding,
} from "../fixtures";
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
  /**
   * Every finding the check produced, each tagged with its case's bucket.
   *
   * The lists above are counts of cases that broke an expectation; this is what
   * the check actually SAID, which is the half a verdict cannot carry. A rule
   * whose message interpolates its captures can have the slots reversed and
   * still fire in every `fail/` case and stay quiet in every `pass/` one.
   *
   * A case counted in `checkFailures` contributes nothing here. A harness
   * failure arrives as a single synthesized error-severity finding, and
   * reporting that as something the rule found would attribute the harness's
   * crash to the rule — the exact confusion `checkFailures` exists to prevent.
   */
  findings: FixtureFinding[];
  /**
   * Every case's verdict, in the order the cases ran.
   *
   * The four lists above are the same information grouped by failure kind;
   * this is it grouped by case, with the line `describeFixtureReport` prints
   * for that case as its message.
   */
  cases: FixtureCaseResult[];
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
 *
 * `cwd` is the project root, and is used only to name a failing case's files
 * project-relative in `cases`, the spelling `findings[].file` uses.
 */
export async function runRuntimeFixtures(
  cwd: string,
  rule: RuntimeRule,
  fixtures: RuntimeFixtures,
  options: RuntimeRunOptions = {}
): Promise<RuntimeFixtureReport> {
  const missingFailures: string[] = [];
  const unexpectedFindings: string[] = [];
  const neverInvoked: string[] = [];
  const checkFailures: FixtureCheckFailure[] = [];
  const findings: FixtureFinding[] = [];
  const cases: FixtureCaseResult[] = [];
  const record = async (fixtureCase: RuntimeFixtureCase, message?: string) => {
    cases.push(await caseResult(cwd, fixtureCase, message));
  };

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
      const failure = {
        name: label(fixtureCase),
        message: execution.failure,
      };
      checkFailures.push(failure);
      await record(fixtureCase, describeCheckFailure(failure));
      continue;
    }

    if (!execution.invoked) {
      neverInvoked.push(label(fixtureCase));
      await record(fixtureCase, describeNeverInvoked(label(fixtureCase)));
      continue;
    }

    // Collected before the bucket expectations are judged, so a case that met
    // its expectation still reports what it found. That is the whole point on
    // the `fail/` side: those findings are the evidence the messages render
    // correctly, and they exist only on the runs that passed.
    for (const finding of execution.findings) {
      findings.push({ ...finding, bucket: fixtureCase.bucket });
    }

    if (fixtureCase.bucket === "fail") {
      if (execution.findings.length === 0) {
        missingFailures.push(label(fixtureCase));
        await record(fixtureCase, describeMissingFailure(label(fixtureCase)));
        continue;
      }
    } else if (execution.findings.length > 0) {
      unexpectedFindings.push(label(fixtureCase));
      await record(fixtureCase, describeUnexpectedFinding(label(fixtureCase)));
      continue;
    }
    await record(fixtureCase);
  }

  return {
    // Only `both` can pass, for `FixtureCoverage`'s reason: a rule with one
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
    findings,
    cases,
  };
}

// One line per kind of case failure. Shared by `describeFixtureReport` and the
// per-case `message`, so the two can never describe one case differently.

function describeMissingFailure(name: string): string {
  return `fail fixture did not fire: ${name}`;
}

function describeUnexpectedFinding(name: string): string {
  return `pass fixture wrongly fired: ${name}`;
}

function describeNeverInvoked(name: string): string {
  return (
    `fixture case matched no captures, so check.ts never ran: ${name}. ` +
    `The case is the defect, not the check: add code the rule's captures match.`
  );
}

function describeCheckFailure(failure: FixtureCheckFailure): string {
  return `check failed on ${failure.name}: ${failure.message}`;
}

/**
 * The report as the lines `verify` prints under the rule.
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

  const shortfall = describeCoverageShortfall(ruleId, report.coverage);
  if (shortfall !== undefined) errors.push(shortfall);
  for (const name of report.missingFailures) {
    errors.push(describeMissingFailure(name));
  }
  for (const name of report.unexpectedFindings) {
    errors.push(describeUnexpectedFinding(name));
  }
  for (const name of report.neverInvoked) {
    errors.push(describeNeverInvoked(name));
  }
  for (const failure of report.checkFailures) {
    errors.push(describeCheckFailure(failure));
  }

  return errors;
}
