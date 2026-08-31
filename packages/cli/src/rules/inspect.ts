import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";

import { parse } from "yaml";

import { ruleCapturesDirectory, ruleConfigPath, ruleFilePath } from "./engines";
import { type EngineName } from "./layout";
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
  /** Absent when `verify` failed and the tests never ran. */
  ran: boolean;
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
  const captures = ruleCapturesDirectory(cwd, engine, ruleId);
  if (captures !== undefined) {
    let found = 0;
    try {
      const entries = await readdir(captures);
      found = entries.filter(
        (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml")
      ).length;
    } catch {
      found = 0;
    }
    if (found === 0) {
      errors.push(
        `${ruleId} has no capture rules in captures/, so check.ts would never be invoked.`
      );
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
  rule: ResolvedRule
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
    if (result.tests.fixtures !== "both") {
      errors.push(
        result.tests.fixtures === "none"
          ? `${ruleId} has no fixtures, so nothing shows it fires or stays quiet.`
          : `${ruleId} has only ${result.tests.fixtures.replace("-only", "")}: fixtures — half a claim.`
      );
    }
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
    if (result.fixtures !== "both") {
      errors.push(
        result.fixtures === "none"
          ? `${ruleId} has no fixtures, so nothing shows it fires or stays quiet.`
          : `${ruleId} has only ${result.fixtures.replace("-only", "")}/ fixtures — half a claim.`
      );
    }
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

  // Runtime rules execute code, so their tests run through the harness under
  // the same server verification `check` requires. Out of scope here: `test`
  // reports that rather than quietly claiming a pass.
  return {
    engine,
    ruleId,
    ok: true,
    errors: [],
    ran: false,
  };
}
