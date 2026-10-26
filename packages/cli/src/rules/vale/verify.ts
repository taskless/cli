import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildOneRuleValeConfig } from "../assemble";
import { listRuleIds, ruleConfigPath, ruleTestsDirectory } from "../engines";
import { RULES_DIRECTORY } from "../layout";
import {
  bucketEntries,
  casePassed,
  describeCaseFailures,
  projectRelative,
  readRuleFixtures,
  type CaseOutcome,
  type FixtureCase,
  type FixtureCoverage,
  type FixtureFinding,
} from "../fixtures";
import { runVale, type ValeRunOutcome } from "./run";

/** Where a rule's fixtures live, relative to the project root. */
export function valeRuleTestsDirectory(cwd: string, ruleId: string): string {
  return ruleTestsDirectory(cwd, "vale", ruleId);
}

/** The styles root Vale resolves `<id>.<id>` against. */
function stylesPath(cwd: string): string {
  return resolve(cwd, ".taskless", RULES_DIRECTORY, "vale");
}

/**
 * An ephemeral config that enables exactly one rule everywhere, `[*]`.
 *
 * NOT what a case is judged under. That is the rule's own matchers (see
 * {@link verifyValeRule}); judging under `[*]` is how a rule whose matchers
 * matched nothing real passed verification and stayed silent in `check`. This
 * config answers one question only: a `fail/` case that stayed quiet under the
 * rule's scope, does it fire with the scope removed? If so, the scope excluded
 * it, and the author is told to move the fixture rather than fix the pattern.
 *
 * It is *isolating*, like the scoped config: a finding from some other rule
 * must not be what got counted.
 *
 * Three details are load-bearing:
 *
 * - `StylesPath` is absolute. The config is written to a temp directory, and
 *   Vale resolves StylesPath relative to the config file, so a relative path
 *   would look for styles beside the temp file.
 * - No `BasedOnStyles` line. The config wrote `BasedOnStyles =` through Vale
 *   3.21.0 on the claim that without it a fixture could fail on
 *   `Vale.Spelling`. Measured on 3.21.0 and 3.22.0, with a document baited
 *   for `Vale.Spelling`, `Vale.Repetition` and `Vale.Terms`: nothing fires
 *   without the key, and every one of them fires under `BasedOnStyles = Vale`.
 *   A bundled style loads only when a run-level `BasedOnStyles` names one.
 *   The line went because 3.22.0 gave an empty value a meaning, clearing a
 *   file's inherited settings, and the config schema refuses it in a rule's
 *   own `.vale.ini` for that reason; the isolating config should not write
 *   the shape `validate` refuses.
 * - Exactly one assignment of the key, in one matcher. Precedence here is
 *   positional in both directions (a later matcher wins, and since Vale
 *   3.21.0 so does a later repeat inside one matcher; through 3.20.0 the
 *   first repeat won), so a config that assigned it twice would be relying
 *   on the rule that bit the scoping spec, and on which Vale is reading it.
 *
 * `scripts/generate-vale-schema.ts` builds a second isolating config for its
 * probes, and `runOne` in `test/vale-schema-contract.test.ts` a third. Neither
 * can call this one, because each owns its whole temp directory and so has no
 * absolute StylesPath to hand over, but both share the other two details
 * above. A new requirement found here belongs in both of them too.
 */
export function buildIsolatingConfig(cwd: string, ruleId: string): string {
  return [
    `StylesPath = ${stylesPath(cwd)}`,
    "MinAlertLevel = suggestion",
    "",
    "[*]",
    `${ruleId}.${ruleId} = YES`,
    "",
  ].join("\n");
}

/** Which buckets a Vale rule populated. See {@link FixtureCoverage}. */
export type ValeFixtureCoverage = FixtureCoverage;

export interface ValeRuleVerification {
  ruleId: string;
  passed: boolean;
  /** `fail/` cases that should have fired and did not, as project-relative directories. */
  missingFailures: string[];
  /** `pass/` cases that should have been clean and were not, as project-relative directories. */
  unexpectedFindings: string[];
  /** One line per case that did not come out as its bucket asserts, ready to print. */
  errors: string[];
  /**
   * Every finding the fixtures produced, each tagged with its bucket.
   *
   * Carried ALONGSIDE the two lists above rather than instead of them. They
   * answer "which fixture is wrong", which is what decides `passed`; this
   * answers "what did the rule actually say", which is what an author needs to
   * see and what no verdict can express — a rule whose message interpolates
   * its captures can have the slots reversed, fire on every `fail/` fixture,
   * stay quiet on every `pass/` one, and pass.
   *
   * Empty when Vale was never run, which a one-sided fixture set short-circuits
   * into, for `findings`' reason on the reported envelope: absent and empty must
   * not be two different answers to the same question.
   */
  findings: FixtureFinding[];
  /**
   * Which buckets held cases. Only `"both"` can be `passed: true`: a `fail/`
   * case proves the rule fires, a `pass/` case proves it does not over-fire,
   * and either alone is half a claim. A rule with only `pass/` cases passes
   * with `missingFailures: []` without ever demonstrating it can fire at all.
   */
  fixtures: ValeFixtureCoverage;
  /**
   * What Vale said about a run that still exited zero, one notice per element.
   *
   * Carried on the verification rather than dropped at this seam because the
   * `W101 … isn't a core option` warning — what Vale says about an assignment
   * placed above the first `[…]` section — arrives on exactly this path: exit
   * zero, empty findings, a rule that validates clean while Vale ignores it.
   * Collected across every case run, deduplicated. Empty when Vale was never
   * run (a one-sided fixture set short-circuits) and when it ran with nothing
   * to say; the two are not worth distinguishing, and empty-never-absent lets a
   * caller concatenate without a fallback.
   */
  notices: string[];
}

/**
 * The Vale outcomes that end a verification instead of producing one.
 *
 * Every member carries a `message`, which is why `verifyValeRule` hands back
 * this rather than the full {@link ValeRunOutcome}: an `ok` run is never what a
 * caller is handed there, so it should not have to write a fallback for the
 * message an `ok` run would not have had.
 */
export type ValeRunFailure = Exclude<ValeRunOutcome, { status: "ok" }>;

export type ValeVerifyOutcome =
  | { status: "ok"; rules: ValeRuleVerification[] }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/**
 * Rule ids that have a populated `tests/` directory.
 *
 * Walks the rule directories rather than a shared tests root: a rule's tests
 * live inside the rule, so "has tests" is a question about the rule directory.
 */
export async function discoverValeRuleTests(cwd: string): Promise<string[]> {
  const ruleIds = await listRuleIds(cwd, "vale");
  const withTests: string[] = [];
  for (const ruleId of ruleIds) {
    const entries = await bucketEntries(valeRuleTestsDirectory(cwd, ruleId));
    if (entries.length > 0) withTests.push(ruleId);
  }
  return withTests;
}

/**
 * Run Vale over one case, with the case directory as its working directory.
 *
 * Vale resolves a matcher against the working directory (measured on 3.24.0:
 * under `[docs/**\/*.md]`, `docs/guide/x.md` in the case fires and `x.md` does
 * not, and the same tree passed from its parent fires nothing), so this is the
 * rule's scope applied to the case as it is applied to a project. No paths:
 * `runVale` treats that as a whole-project walk of the case, the walk `check`
 * makes of a repository.
 */
async function runCase(
  cwd: string,
  ruleId: string,
  fixture: FixtureCase,
  configPath: string,
  timeoutMs: number | undefined
): Promise<
  | { findings: FixtureFinding[]; notices: string[] }
  | { outcome: ValeRunFailure }
> {
  const outcome = await runVale({ cwd: fixture.root, configPath, timeoutMs });
  if (outcome.status !== "ok") return { outcome };
  // Only findings for the rule under test count. The config isolates it, so
  // this should be every finding; filtering anyway means a leak shows up as a
  // verification that still measures the right thing.
  const findings = outcome.results
    .filter((result) => result.ruleId === ruleId)
    .map((result) => ({
      ...result,
      file: projectRelative(cwd, join(fixture.root, result.file)),
      bucket: fixture.bucket,
    }));
  return { findings, notices: outcome.notices };
}

/**
 * Verify one rule against its fixture cases.
 *
 * Each case is linted under the rule's OWN matchers, so verification exercises
 * the scope the rule declares. It used to enable the rule under `[*]`, which
 * the spec never asked for: a rule whose matchers matched nothing real passed
 * verification and stayed silent in `check`. A `fail/` case that stays quiet
 * is linted once more under `[*]`, and if it fires then, the failure says the
 * scope excluded it.
 *
 * Both buckets have to hold at least one case before the rule can report
 * `passed: true`, for {@link ValeFixtureCoverage}'s reason.
 *
 * Non-`ok` outcomes come back as `{ outcome }` rather than a verification.
 * The discriminant is deliberately not named for the unavailable case: it
 * carries `timeout` and `failed` too, and a name like `unavailable` invites a
 * caller to treat a genuine Vale failure as a skip.
 */
export async function verifyValeRule(
  cwd: string,
  ruleId: string,
  options: { timeoutMs?: number } = {}
): Promise<ValeRuleVerification | { outcome: ValeRunFailure }> {
  const empty = (
    fixtures: ValeFixtureCoverage,
    errors: string[]
  ): ValeRuleVerification => ({
    ruleId,
    passed: false,
    missingFailures: [],
    unexpectedFindings: [],
    errors,
    findings: [],
    fixtures,
    notices: [],
  });

  let read;
  try {
    read = await readRuleFixtures(cwd, "vale", ruleId);
  } catch (error) {
    return empty("none", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  // Short-circuited before Vale runs: the rule has to be edited either way, so
  // there is nothing a subprocess could add that `fixtures` does not say.
  if (read.coverage !== "both") return empty(read.coverage, []);

  const configFile = ruleConfigPath(cwd, "vale", ruleId);
  const source =
    configFile === undefined ? undefined : await readFile(configFile, "utf8");
  const scopedConfig =
    source === undefined
      ? undefined
      : buildOneRuleValeConfig(stylesPath(cwd), ruleId, source);
  if (scopedConfig === undefined) {
    // `validate` runs first and refuses a missing or rejected `.vale.ini`, so
    // this is reached only by a caller that skipped it.
    return empty(read.coverage, [
      `${ruleId}'s .vale.ini is missing or rejected, so there is no scope to verify under. Run validate.`,
    ]);
  }

  const scratch = await mkdtemp(join(tmpdir(), `vale-verify-${ruleId}-`));
  try {
    const scopedPath = join(scratch, "scoped.ini");
    const unscopedPath = join(scratch, "unscoped.ini");
    await writeFile(scopedPath, scopedConfig, "utf8");
    await writeFile(unscopedPath, buildIsolatingConfig(cwd, ruleId), "utf8");

    const outcomes: CaseOutcome[] = [];
    const notices = new Set<string>();
    for (const fixture of read.cases) {
      const run = await runCase(
        cwd,
        ruleId,
        fixture,
        scopedPath,
        options.timeoutMs
      );
      if ("outcome" in run) return run;
      for (const notice of run.notices) notices.add(notice);
      const outcome: CaseOutcome = { fixture, findings: run.findings };
      if (fixture.bucket === "fail" && !casePassed(outcome)) {
        const unscoped = await runCase(
          cwd,
          ruleId,
          fixture,
          unscopedPath,
          options.timeoutMs
        );
        if ("outcome" in unscoped) return unscoped;
        outcome.quiet =
          unscoped.findings.length > 0 ? "scope-excluded" : "no-match";
      }
      outcomes.push(outcome);
    }

    const failing = outcomes.filter((outcome) => !casePassed(outcome));
    const caseDirectory = (outcome: CaseOutcome) =>
      `${projectRelative(cwd, outcome.fixture.root)}/`;
    return {
      ruleId,
      passed: failing.length === 0,
      missingFailures: failing
        .filter((outcome) => outcome.fixture.bucket === "fail")
        .map((outcome) => caseDirectory(outcome)),
      unexpectedFindings: failing
        .filter((outcome) => outcome.fixture.bucket === "pass")
        .map((outcome) => caseDirectory(outcome)),
      errors: describeCaseFailures(
        cwd,
        outcomes,
        "the rule's .vale.ini matchers"
      ),
      findings: outcomes.flatMap((outcome) => outcome.findings),
      fixtures: read.coverage,
      notices: [...notices],
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Verify every rule that has fixtures.
 *
 * An unavailable or failed Vale stops the whole pass rather than being recorded
 * per rule: with no working binary every rule would report "no findings", which
 * is indistinguishable from every rule being broken. Reporting that as a wall
 * of verification failures would send someone to debug their rules over a
 * missing install.
 */
export async function verifyValeRules(
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<ValeVerifyOutcome> {
  const ruleIds = await discoverValeRuleTests(cwd);
  const rules: ValeRuleVerification[] = [];

  for (const ruleId of ruleIds) {
    const result = await verifyValeRule(cwd, ruleId, options);
    if ("outcome" in result) {
      const { outcome } = result;
      return {
        status: outcome.status === "unavailable" ? "unavailable" : "failed",
        message: outcome.message,
      };
    }
    rules.push(result);
  }

  return { status: "ok", rules };
}
