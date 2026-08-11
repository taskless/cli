import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve, sep } from "node:path";

import { ENGINE_LAYOUTS } from "../engines";
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

/** Fixture documents directly under `<rule-tests>/<rule>/<bucket>/`. */
async function fixtureFiles(
  cwd: string,
  ruleId: string,
  bucket: "pass" | "fail"
): Promise<string[]> {
  const directory = join(valeRuleTestsDirectory(cwd, ruleId), bucket);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

/** Vale keys findings by the path it was given, so compare in that shape. */
function toRelativePosix(cwd: string, absolute: string): string {
  return absolute
    .slice(cwd.length + 1)
    .split(sep)
    .join(posix.sep);
}

export interface ValeRuleVerification {
  ruleId: string;
  passed: boolean;
  /** Fixtures that should have fired and did not. */
  missingFailures: string[];
  /** Fixtures that should have been clean and were not. */
  unexpectedFindings: string[];
  /** No `pass/` and no `fail/` documents — nothing was actually proven. */
  empty: boolean;
}

export type ValeVerifyOutcome =
  | { status: "ok"; rules: ValeRuleVerification[] }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/** Rule ids that have a `rule-tests/<id>/` directory. */
export async function discoverValeRuleTests(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(valeRuleTestsDirectory(cwd), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
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
 */
export async function verifyValeRule(
  cwd: string,
  ruleId: string,
  options: { timeoutMs?: number } = {}
): Promise<ValeRuleVerification | { unavailable: ValeRunOutcome }> {
  const [passFixtures, failFixtures] = await Promise.all([
    fixtureFiles(cwd, ruleId, "pass"),
    fixtureFiles(cwd, ruleId, "fail"),
  ]);

  if (passFixtures.length === 0 && failFixtures.length === 0) {
    return {
      ruleId,
      passed: false,
      missingFailures: [],
      unexpectedFindings: [],
      empty: true,
    };
  }

  const configDirectory = mkdtempSync(join(tmpdir(), `vale-verify-${ruleId}-`));
  const configPath = join(configDirectory, ".vale.ini");
  writeFileSync(configPath, buildIsolatingConfig(cwd, ruleId));

  try {
    const outcome = await runVale({
      cwd,
      configPath,
      paths: [toRelativePosix(cwd, valeRuleTestsDirectory(cwd, ruleId))],
      timeoutMs: options.timeoutMs,
    });
    if (outcome.status !== "ok") return { unavailable: outcome };

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
      empty: false,
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
    if ("unavailable" in result) {
      const outcome = result.unavailable;
      return {
        status: outcome.status === "unavailable" ? "unavailable" : "failed",
        message: "message" in outcome ? outcome.message : "Vale failed",
      };
    }
    rules.push(result);
  }

  return { status: "ok", rules };
}
