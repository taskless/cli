import { type Dirent, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative, resolve, sep } from "node:path";

import { ENGINE_LAYOUTS } from "../engines";
import { isMissingDirectory } from "../errno";
import { runVale, type ValeRunOutcome } from "./run";

/** Where a rule's fixtures live, relative to the project root. */
export function valeRuleTestsDirectory(cwd: string, ruleId?: string): string {
  const base = join(cwd, ".taskless", ENGINE_LAYOUTS.vale.ruleTestsDirectory);
  return ruleId === undefined ? base : join(base, ruleId);
}

/** The styles root Vale resolves `rules.<name>` against. */
function stylesPath(cwd: string): string {
  return resolve(cwd, ".taskless", "vale");
}

/**
 * An ephemeral config that enables exactly one rule and nothing else.
 *
 * Generated rather than committed, per the spec: verification is one-time, and
 * a `rule-tests/<rule>/` subdirectory holds fixtures only. It also has to be
 * *isolating* — a `pass/` fixture proves the rule under test does not fire, and
 * that claim is worthless if some other rule's finding is what got counted.
 *
 * Three details are load-bearing:
 *
 * - `StylesPath` is absolute. The config is written to a temp directory, and
 *   Vale resolves StylesPath relative to the config file, so a relative path
 *   would look for styles beside the temp file.
 * - `BasedOnStyles =` is empty, so none of Vale's bundled styles load. Without
 *   it a fixture could fail on `Vale.Spelling` and be read as the rule firing.
 * - Exactly one assignment of the key, in one matcher. Precedence here is
 *   positional (a later matcher wins; a repeat inside one matcher is
 *   discarded), so a config that assigned it twice would be relying on the
 *   rule that bit the scoping spec.
 */
export function buildIsolatingConfig(cwd: string, ruleId: string): string {
  return [
    `StylesPath = ${stylesPath(cwd)}`,
    "MinAlertLevel = suggestion",
    "",
    "[*]",
    "BasedOnStyles =",
    `rules.${ruleId} = YES`,
    "",
  ].join("\n");
}

/**
 * Directory entries, with a directory that is not there reading as an empty one.
 *
 * The single place that decides which `readdir` failures are absence and which
 * are problems, so no caller can accidentally answer that question differently.
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
 * Fixture documents directly under `<rule-tests>/<rule>/<bucket>/`.
 *
 * A missing directory is an empty bucket; anything else rethrows. The buckets
 * are read independently, so a swallowed `EACCES` on `pass/` would silently
 * yield `[]` while `fail/` still had fixtures — the rule would not look
 * one-sided, and could report `passed: true` having never checked the pass side
 * at all. A permissions problem must not read as "no pass fixtures were
 * written".
 *
 * A bucket is one directory deep, and a nested directory is rejected rather
 * than ignored. The two halves of verification disagree about recursion: this
 * read is flat, but Vale is invoked over the whole `rule-tests/<rule>` tree and
 * lints recursively. Silently skipping a nested entry therefore fails in the
 * dangerous direction — a nested `pass/` fixture that wrongly fires produces a
 * finding this function never collected, so `unexpectedFindings` discards it,
 * and a nested `fail/` fixture is never required to fire. Either way the rule
 * reports `passed: true` while half its fixtures went unchecked, which is the
 * exact failure `ValeFixtureCoverage` exists to prevent.
 *
 * Flat-and-loud is chosen over recursing because it keeps one layout legal
 * instead of two, and because the error names the offending path at the moment
 * someone creates it.
 */
async function fixtureFiles(
  cwd: string,
  ruleId: string,
  bucket: "pass" | "fail"
): Promise<string[]> {
  const directory = join(valeRuleTestsDirectory(cwd, ruleId), bucket);
  const entries = await directoryEntries(directory);

  const nested = entries.find((entry) => entry.isDirectory());
  if (nested !== undefined) {
    throw new Error(
      `Vale fixture buckets are flat: ${join(directory, nested.name)} is a ` +
        `directory. Move its documents directly into ${bucket}/ — Vale lints ` +
        `the rule's whole directory, so a nested fixture is linted but never ` +
        `checked.`
    );
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(directory, entry.name));
}

/** Vale keys findings by the path it was given, so compare in that shape. */
function toRelativePosix(cwd: string, absolute: string): string {
  return relative(cwd, absolute).split(sep).join(posix.sep);
}

/**
 * Which fixture buckets a rule actually populated.
 *
 * This replaces the earlier `empty: boolean`, which only distinguished "no
 * fixtures at all" from everything else and so let a one-sided rule report
 * `passed: true`. The four cases are kept apart because a caller wants to say
 * different things about them: `"none"` is an unwritten rule, while
 * `"fail-only"`/`"pass-only"` is a half-written one, which is the more
 * misleading state of the two.
 */
export type ValeFixtureCoverage = "both" | "pass-only" | "fail-only" | "none";

/** Classify a rule's buckets by how many documents each held. */
function coverageOf(passCount: number, failCount: number): ValeFixtureCoverage {
  if (passCount > 0 && failCount > 0) return "both";
  if (passCount > 0) return "pass-only";
  if (failCount > 0) return "fail-only";
  return "none";
}

export interface ValeRuleVerification {
  ruleId: string;
  passed: boolean;
  /** Fixtures that should have fired and did not. */
  missingFailures: string[];
  /** Fixtures that should have been clean and were not. */
  unexpectedFindings: string[];
  /**
   * Which buckets held documents. Only `"both"` can be `passed: true`: a
   * `fail/` fixture proves the rule fires, a `pass/` fixture proves it does not
   * over-fire, and either alone is half a claim. A rule with only `pass/`
   * fixtures passes with `missingFailures: []` without ever demonstrating the
   * rule can fire at all.
   */
  fixtures: ValeFixtureCoverage;
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

/** Rule ids that have a `rule-tests/<id>/` directory. */
export async function discoverValeRuleTests(cwd: string): Promise<string[]> {
  const entries = await directoryEntries(valeRuleTestsDirectory(cwd));
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/**
 * Verify one rule against its fixtures.
 *
 * Both buckets run in a single Vale invocation over the rule's directory —
 * `pass/` and `fail/` are siblings, so one run covers them and halves the
 * process spawns.
 *
 * A fixture that produces no finding does not appear in Vale's output at all,
 * so the expected set comes from disk rather than from the output: absence is
 * the signal for `pass/` and the failure for `fail/`, and neither can be read
 * off a payload that simply omits them.
 *
 * Both buckets have to hold at least one document before the rule can report
 * `passed: true`. An empty fixture directory proves nothing, and reporting it
 * as passing is how an unverified rule ships looking verified — but so is a
 * rule with only `fail/` fixtures (never shown not to over-fire) or only
 * `pass/` fixtures (never shown to fire at all, passing on an empty
 * `missingFailures`). The one-sided cases are the same failure mode, one level
 * less obvious, so `fixtures` records which buckets were populated and only
 * `"both"` is verifiable.
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
  const [passFixtures, failFixtures] = await Promise.all([
    fixtureFiles(cwd, ruleId, "pass"),
    fixtureFiles(cwd, ruleId, "fail"),
  ]);

  // Short-circuited before Vale runs: the rule has to be edited either way, so
  // there is nothing a subprocess could add that `fixtures` does not say.
  const fixtures = coverageOf(passFixtures.length, failFixtures.length);
  if (fixtures !== "both") {
    return {
      ruleId,
      passed: false,
      missingFailures: [],
      unexpectedFindings: [],
      fixtures,
    };
  }

  const configDirectory = mkdtempSync(join(tmpdir(), `vale-verify-${ruleId}-`));
  const configPath = join(configDirectory, ".vale.ini");

  try {
    writeFileSync(configPath, buildIsolatingConfig(cwd, ruleId));

    const outcome = await runVale({
      cwd,
      configPath,
      paths: [toRelativePosix(cwd, valeRuleTestsDirectory(cwd, ruleId))],
      timeoutMs: options.timeoutMs,
    });
    if (outcome.status !== "ok") return { outcome };

    // Only findings for the rule under test count. The config isolates it, so
    // this should be every finding — filtering anyway means a leak shows up as
    // a verification that still measures the right thing.
    const firedIn = new Set(
      outcome.results
        .filter((result) => result.ruleId === ruleId)
        .map((result) => result.file)
    );

    const missingFailures = failFixtures
      .map((file) => toRelativePosix(cwd, file))
      .filter((file) => !firedIn.has(file));
    const unexpectedFindings = passFixtures
      .map((file) => toRelativePosix(cwd, file))
      .filter((file) => firedIn.has(file));

    return {
      ruleId,
      passed: missingFailures.length === 0 && unexpectedFindings.length === 0,
      missingFailures,
      unexpectedFindings,
      fixtures,
    };
  } finally {
    rmSync(configDirectory, { recursive: true, force: true });
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
