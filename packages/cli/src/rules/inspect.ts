import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";

import { parse } from "yaml";

import {
  ruleCapturesDirectory,
  ruleConfigPath,
  ruleFilePath,
  type EngineName,
} from "./engines";
import { verifyRule } from "./verify";
import { verifyValeRule } from "./vale/verify";
import type { ResolvedRule } from "./resolve-path";

/** What `verify` concluded about one rule. */
export interface RuleVerification {
  engine: EngineName;
  ruleId: string;
  ok: boolean;
  errors: string[];
}

/** What `test` concluded about one rule. */
export interface RuleTestResult {
  engine: EngineName;
  ruleId: string;
  ok: boolean;
  errors: string[];
  /** Absent when `verify` failed and the tests never ran. */
  ran: boolean;
}

async function readYaml(path: string): Promise<unknown> {
  return parse(await readFile(path, "utf8")) as unknown;
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
    // The ast-grep verifier already layers schema and required fields; only its
    // test layer is `test`'s business, so it is not consulted here.
    const result = await verifyRule(cwd, ruleId);
    errors.push(...result.schema.errors, ...result.requirements.errors);
    return { engine, ruleId, ok: errors.length === 0, errors };
  }

  if (engine === "vale") {
    const stylePath = ruleFilePath(cwd, engine, ruleId);
    try {
      const style = await readYaml(stylePath);
      if (typeof style !== "object" || style === null) {
        errors.push(`${ruleId}.yml is not a YAML mapping.`);
      } else {
        // `extends` and `message` are Vale's own required keys. Checking them
        // here means an author hears about a missing one from `verify` rather
        // than as an E201 buried in an engine failure at check time.
        const record = style as Record<string, unknown>;
        if (typeof record.extends !== "string") {
          errors.push(`${ruleId}.yml is missing the required 'extends' key.`);
        }
        if (typeof record.message !== "string") {
          errors.push(`${ruleId}.yml is missing the required 'message' key.`);
        }
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
        const level = record.level;
        if (
          level !== undefined &&
          (typeof level !== "string" ||
            !["suggestion", "warning", "error"].includes(level))
        ) {
          errors.push(
            `${ruleId}.yml has an invalid level; it must be suggestion, warning, or error.`
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
  const verification = await verifyOneRule(cwd, rule);
  if (!verification.ok) {
    return { ...verification, ran: false };
  }

  const { engine, ruleId } = rule;

  if (engine === "sg") {
    const result = await verifyRule(cwd, ruleId);
    return {
      engine,
      ruleId,
      ok: result.tests.valid,
      errors: result.tests.errors,
      ran: true,
    };
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
    return { engine, ruleId, ok: result.passed, errors, ran: true };
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
