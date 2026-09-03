import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import {
  ruleCapturesDirectory,
  ruleConfigPath,
  ruleDirectory,
  ruleFilePath,
} from "./engines";
import { describeCoverageShortfall } from "./fixtures";
import { type EngineName } from "./layout";
import {
  assessCaptureDirectory,
  discoverRuntimeRules,
  strayModules,
} from "./runtime/discover";
import { readRuntimeFixtures } from "./runtime/fixtures";
import { RUN_SCRIPTS_WARNING } from "./runtime/harness";
import {
  describeFixtureReport,
  runRuntimeFixtures,
} from "./runtime/run-fixtures";
import { validateValeRule } from "../schemas/vale-rule";
import { verifyRule, type VerifyResult } from "./verify";
import { verifyValeRule } from "./vale/verify";
import type { ResolvedRule } from "./resolve-path";

/** What `verify` concluded about one rule. */
export interface RuleVerification {
  engine: EngineName;
  ruleId: string;
  ok: boolean;
  errors: string[];
  /**
   * Something true about the rule that does not make it invalid. An sg rule
   * spelled `language: typescript` reaches the right parser and fails nothing,
   * but the canonical spelling is `TypeScript` — worth saying, not worth
   * failing. Surfaced even on a pass, for the same reason
   * {@link RuleTestResult.notice} is.
   */
  notice?: string;
}

/** What `test` concluded about one rule. */
export interface RuleTestResult {
  engine: EngineName;
  ruleId: string;
  ok: boolean;
  errors: string[];
  /**
   * Whether the rule's tests actually ran.
   *
   * Load-bearing rather than advisory. `test` used to report a runtime rule as
   * `ok: true, ran: false` and print a tick, so the one field that knew the
   * rule had not been tested was the one nothing read.
   */
  ran: boolean;
  /**
   * Set when the execution policy refused the run, carrying the reason.
   *
   * The third outcome, and the one `ok` cannot express. A rule that cannot run
   * because nothing blessed it is not a pass, and it is not a failure either:
   * failing it would turn `test` red for every project holding a runtime rule,
   * with no action available to its holder that makes it green. So it is
   * neither, and the renderer, the summary count and the exit code all read
   * this field rather than inferring the state from `ok` and `ran` together
   * (which cannot distinguish it from a rule whose `verify` failed).
   */
  refused?: string;
  /**
   * Something the engine said about its own configuration, as opposed to about
   * the rule. Vale reports a misplaced `.vale.ini` assignment this way: it
   * exits zero and finds nothing, so the run looks clean precisely when the
   * rule was never enabled. Carried separately from `errors` because it does
   * not make the result a failure — and surfaced even on a pass, since a pass
   * is the case it exists for.
   */
  notice?: string;
}

/** What `test` needs beyond a rule, all of it about the runtime engine. */
export interface TestOptions {
  /**
   * Run a runtime rule's fixtures, which executes its `check.ts`.
   *
   * The WHOLE gate for `test`, and deliberately not `check`'s gate. `check`
   * reconciles because it executes rules as a side effect of scanning a
   * repository: the user asked for a scan, code ran, and the gate is what stops
   * that happening silently. `test` runs fixtures because the user asked it to
   * — the verb is the consent — so asking a server for permission to run your
   * own fixtures is overreach, and the flag alone decides.
   *
   * That is STRICTLY MORE CONSERVATIVE than gating on reconcile as well:
   * nothing executes here that would not have executed before, and a blessed
   * rule that previously ran without the flag now requires it. Absent, which
   * is the safe default, every runtime rule is refused.
   */
  dangerouslyRunScripts?: boolean;
  /**
   * Called immediately before fixtures actually execute, never otherwise.
   *
   * Lazy so `test --dangerously-run-scripts` over a tree of `sg` rules does not
   * warn about code it never ran. Deduplication belongs to the caller, which
   * knows how many rules one command run covers.
   */
  onRuntimeWarning?: (message: string) => void;
}

async function readYaml(path: string): Promise<unknown> {
  return parse(await readFile(path, "utf8")) as unknown;
}

/**
 * ast-grep's verify verdict and the full layer result behind it, from **one**
 * `verifyRule` call.
 *
 * `verify` and `test` want different halves of the same three-layer run:
 * `verify` reads Layers 1–2, `test` needs Layer 3 as well. Asking twice —
 * once for the verdict, once for the tests — assembled the config and spawned
 * `sg test` twice for every rule, so `taskless test` paid two subprocesses per
 * rule to produce one answer. Returning both halves from a single call keeps
 * each caller's view unchanged and runs the layers once.
 */
async function verifySgRule(
  cwd: string,
  ruleId: string,
  options?: { runTests?: boolean }
): Promise<{ verification: RuleVerification; result: VerifyResult }> {
  const result = await verifyRule(cwd, ruleId, options);
  // The ast-grep verifier already layers schema and required fields; only its
  // test layer is `test`'s business, so it is not part of the verdict here.
  const errors = [...result.schema.errors, ...result.requirements.errors];
  return {
    verification: {
      engine: "sg",
      ruleId,
      ok: errors.length === 0,
      errors,
      ...(result.schema.notice === undefined
        ? {}
        : { notice: result.schema.notice }),
    },
    result,
  };
}

/**
 * Check that a rule has the components its engine requires.
 *
 * Deliberately does **not** require tests. An agent part-way through authoring
 * has a rule and no fixtures yet, and needs to know the rule itself is valid
 * before it can write a meaningful test for it — which is the whole reason
 * `verify` and `test` are separate commands.
 */
export async function verifyOneRule(
  cwd: string,
  { engine, ruleId }: ResolvedRule
): Promise<RuleVerification> {
  const errors: string[] = [];

  if (engine === "sg") {
    // Layers 1–2 only: running the tests here would spawn `sg test` for a
    // caller that never looks at the result.
    const { verification } = await verifySgRule(cwd, ruleId, {
      runTests: false,
    });
    return verification;
  }

  if (engine === "vale") {
    const stylePath = ruleFilePath(cwd, engine, ruleId);
    try {
      const style = await readYaml(stylePath);
      // Layer 1 for `vale`, the counterpart of the ast-grep schema layer:
      // `extends`, `message`, `level`, the `scope` grammar, and the per-check
      // field tables, all measured against the pinned binary. It runs here,
      // before Vale is ever invoked, because two of the three defects it
      // catches are not local — Vale reads one assembled config per run, so an
      // unknown `extends` or a foreign field takes down every other Vale
      // rule's findings rather than just this one's.
      errors.push(...validateValeRule(ruleId, style).errors);

      if (typeof style === "object" && style !== null) {
        const record = style as Record<string, unknown>;
        // `consistency` is the one extension point that compiles the rule's
        // own name into the pattern: Vale emits `(?P<<id>N>…)` named capture
        // groups, and Go RE2 requires a group name to be word characters
        // only. Measured against Vale 3.17.1, a hyphenated id fails the file
        // with `E201 … invalid group name`, and because Vale takes one config
        // for the whole run that failure takes **every** Vale rule in the
        // project down with it. Caught here so the author hears it while
        // writing one rule rather than as a project-wide engine outage. Every
        // other extension point is measured fine with a hyphen.
        if (record.extends === "consistency" && !/^\w+$/.test(ruleId)) {
          errors.push(
            `${ruleId} extends consistency, so its id becomes a regex group name and must be word characters only. Rename it without '-' (Vale would fail the whole run with E201).`
          );
        }
      }
    } catch {
      errors.push(`Style file not found or unreadable: ${stylePath}`);
    }

    // A Vale rule with no config of its own declares no scope, so it is enabled
    // nowhere — it would verify, run, and report nothing. That is the silent
    // disable this engine's design exists to prevent, so it is an error here.
    const configPath = ruleConfigPath(cwd, engine, ruleId);
    if (configPath !== undefined) {
      try {
        const config = await readFile(configPath, "utf8");
        if (!config.includes("[")) {
          errors.push(
            `${ruleId}/.vale.ini declares no matcher, so the rule is scoped to nothing and will never run.`
          );
        } else if (!config.includes(`${ruleId}.${ruleId}`)) {
          errors.push(
            `${ruleId}/.vale.ini never enables ${ruleId}.${ruleId}, so the rule is present but off.`
          );
        }
      } catch {
        errors.push(
          `${ruleId} has no .vale.ini, so nothing scopes it and it will never run.`
        );
      }
    }

    return { engine, ruleId, ok: errors.length === 0, errors };
  }

  // runtime
  const checkFile = ruleFilePath(cwd, engine, ruleId);
  try {
    await readFile(checkFile, "utf8");
  } catch {
    errors.push(`Missing check.ts at ${checkFile}`);
  }
  // `check.ts` is the only executable surface and the only signed artifact, so
  // a second module beside it is code reachable from a blessed entry point
  // without being blessed itself. The generator commits to emitting one; this
  // is what makes that a property of our side rather than a promise held on
  // the other side of a wire.
  const strays = await strayModules(ruleDirectory(cwd, engine, ruleId));
  if (strays.length > 0) {
    errors.push(
      `${ruleId} contains ${strays.join(", ")} beside check.ts. A runtime rule has exactly one executable file, because only check.ts is signed — anything else it imports would run unverified. The rule is skipped.`
    );
  }

  const captures = ruleCapturesDirectory(cwd, engine, ruleId);
  if (captures !== undefined) {
    const assessed = await assessCaptureDirectory(captures);
    if (assessed.length === 0) {
      errors.push(
        `${ruleId} has no capture rules in captures/, so check.ts would never be invoked.`
      );
    }

    // Discovery refuses a capture it cannot run, which means the capture
    // simply is not there at scan time. On its own that reads as a rule that
    // found nothing — the failure this engine's design exists to prevent — so
    // the reason is named here, while the author is looking at one rule rather
    // than at an empty report.
    //
    // The SAME enumeration and the SAME assessor discovery uses, so "verify
    // says it is fine" and "the run silently skipped it" cannot come apart —
    // neither about which files are candidates, nor about what each one is.
    for (const { fileName, assessment } of assessed) {
      if (!assessment.ok) {
        errors.push(
          `${ruleId}/captures/${fileName} ${assessment.reason}. The capture is skipped, so the rule would run against less than it was written for.`
        );
      }
    }
  }
  return { engine, ruleId, ok: errors.length === 0, errors };
}

/**
 * Run a rule's tests, after verifying it.
 *
 * `verify` runs first and stops on failure. Ordering is the point: when a rule
 * is both malformed and under-fixtured, the fixture complaint is the less
 * useful of the two errors and is the one that surfaces first if the checks run
 * the other way round — so the author is told their fixtures are incomplete
 * while the reason the rule could never have run goes unmentioned.
 */
export async function testOneRule(
  cwd: string,
  rule: ResolvedRule,
  options: TestOptions = {}
): Promise<RuleTestResult> {
  const { engine, ruleId } = rule;

  if (engine === "sg") {
    // One call covers both halves. The verdict is still consulted first and
    // still short-circuits, so the ordering above is unchanged — the tests
    // simply already ran alongside the layers that decide it.
    const { verification, result } = await verifySgRule(cwd, ruleId);
    if (!verification.ok) {
      return { ...verification, ran: false };
    }
    const errors = [...result.tests.errors];
    // Mirrors the Vale branch below, and for the same reason: a rule that
    // populated only one bucket has proved only half of what a rule claims.
    // `ast-grep test` will not say so — an empty `invalid:` bucket is
    // `1 passed; 0 failed`, exit zero — so the message has to come from here.
    //
    // `:` rather than `/` because ast-grep's buckets are the `valid:`/`invalid:`
    // KEYS of a test YAML document, not directories. The other two engines read
    // `pass/`. Naming a bucket in the shape the author will search for is the
    // point of the message, so the difference is deliberate, not drift.
    const shortfall = describeCoverageShortfall(
      ruleId,
      result.tests.fixtures,
      ":"
    );
    if (shortfall !== undefined) errors.push(shortfall);
    return {
      engine,
      ruleId,
      ok: result.tests.valid,
      errors,
      ran: true,
      ...(verification.notice === undefined
        ? {}
        : { notice: verification.notice }),
    };
  }

  const verification = await verifyOneRule(cwd, rule);
  if (!verification.ok) {
    return { ...verification, ran: false };
  }

  if (engine === "vale") {
    const result = await verifyValeRule(cwd, ruleId);
    if ("outcome" in result) {
      return {
        engine,
        ruleId,
        ok: false,
        errors: [result.outcome.message],
        ran: false,
      };
    }
    const errors: string[] = [];
    // `/` because Vale's buckets are directories; see the `sg` branch above for
    // why that suffix is a parameter rather than one spelling for all three.
    const shortfall = describeCoverageShortfall(ruleId, result.fixtures, "/");
    if (shortfall !== undefined) errors.push(shortfall);
    for (const file of result.missingFailures) {
      errors.push(`fail fixture did not fire: ${file}`);
    }
    for (const file of result.unexpectedFindings) {
      errors.push(`pass fixture wrongly fired: ${file}`);
    }
    return {
      engine,
      ruleId,
      ok: result.passed,
      errors,
      ran: true,
      ...(result.notice === undefined ? {} : { notice: result.notice }),
    };
  }

  // Runtime rules execute code, so `test` runs their fixtures only behind
  // `--dangerously-run-scripts`. It does NOT reconcile, and that is the whole
  // difference from `check`.
  //
  // `check` asks the server because it executes rules as a SIDE EFFECT of
  // scanning a repository — nobody asked for code to run, so a gate has to
  // stand between the scan and the execution. `test` runs fixtures because the
  // user typed `test`, and the verb is the consent; asking a server for
  // permission to run your own fixtures is overreach.
  //
  // The only party a reconcile here would ever admit is someone testing an
  // already-blessed delivered rule, whose fixtures the service verified before
  // it delivered anything. A locally authored rule has no signature and never
  // will, because blessing is recording and nothing recorded it — so for the
  // audience that actually runs `test` on a runtime rule, a reconcile is pure
  // cost paid for an answer that is always "no".
  //
  // Dropping it is strictly more conservative: nothing runs that would not have
  // run before, and the blessed case that used to run without the flag now
  // needs it. It also removes the `--anonymous` question rather than answering
  // it, since with no network there is nothing to suppress.
  if (options.dangerouslyRunScripts !== true) {
    // Neither a pass nor a failure (D2), and the message has to say what would
    // change it. The flag is the only route for anyone, so naming it here is
    // the difference between a dead end and an instruction.
    const reason =
      `fixtures did not run: running them executes the rule's check.ts. ` +
      `Pass --dangerously-run-scripts to run them.`;
    return {
      engine,
      ruleId,
      ok: false,
      errors: [reason],
      ran: false,
      refused: reason,
    };
  }

  // Discovery, not a plan: the bytes are the working tree's, which is the point
  // of testing a rule you are authoring. `discoverRuntimeRules` is the same
  // enumeration `check` plans over, so a rule it refuses — no loadable capture,
  // or an unsigned module beside `check.ts` — is refused here identically
  // rather than by a second opinion. `verify` has already run and named the
  // real defect; this reports that nothing was run, not a verdict on the rule.
  const discovered = await discoverRuntimeRules(cwd);
  const runtimeRule = discovered.find((candidate) => candidate.name === ruleId);
  if (runtimeRule === undefined) {
    const reason =
      `fixtures did not run: it was not discovered as a runnable runtime ` +
      `rule (no capture rules under captures/).`;
    return {
      engine,
      ruleId,
      ok: false,
      errors: [reason],
      ran: false,
      refused: reason,
    };
  }

  let fixtures;
  try {
    fixtures = await readRuntimeFixtures(cwd, ruleId);
  } catch (error) {
    // A bucket that could not be read, or an entry that is not a directory.
    // Both are failures of the fixtures rather than refusals of the run, so
    // they fail: the alternative is a bucket reading as empty, which makes a
    // two-sided rule look one-sided and a one-sided rule look complete.
    return {
      engine,
      ruleId,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      ran: false,
    };
  }

  // Warned at the last possible moment: everything above can still decline to
  // run anything, and a warning about code that never executed is noise.
  options.onRuntimeWarning?.(RUN_SCRIPTS_WARNING);

  const report = await runRuntimeFixtures(runtimeRule, fixtures);
  return {
    engine,
    ruleId,
    ok: report.passed,
    errors: describeFixtureReport(ruleId, report),
    ran: true,
  };
}
