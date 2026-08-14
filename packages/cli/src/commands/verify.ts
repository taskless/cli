import { resolve } from "node:path";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  testOneRule,
  verifyOneRule,
  type RuleTestResult,
  type RuleVerification,
} from "../rules/inspect";
import {
  PathOutsideRulesError,
  resolveRulePath,
  RuleNotFoundError,
} from "../rules/resolve-path";
import { makeErrorEnvelope } from "../types/errors";

/**
 * The shared body of `verify` and `test`.
 *
 * Both take a path, resolve it to rules, and report per rule — they differ only
 * in what they run against each. Keeping one implementation means the two can
 * never disagree about what a path means, which is the property that makes
 * `verify <path>` and `test <path>` interchangeable in a recipe.
 */
async function runOverPath(options: {
  cwd: string;
  target: string;
  json: boolean;
  /** What the command is called, for messages. */
  label: "verify" | "test";
  run: (
    cwd: string,
    rule: { engine: "sg" | "vale" | "runtime"; ruleId: string }
  ) => Promise<RuleVerification | RuleTestResult>;
}): Promise<void> {
  const { cwd, target, json, label, run } = options;

  await ensureTasklessDirectory(cwd);

  let rules;
  try {
    rules = await resolveRulePath(cwd, target);
  } catch (error) {
    if (
      error instanceof PathOutsideRulesError ||
      error instanceof RuleNotFoundError
    ) {
      const message = error.message;
      if (json) {
        console.log(
          JSON.stringify(makeErrorEnvelope("INVALID_INPUT", message))
        );
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (rules.length === 0) {
    // Not an error: an empty rules tree is the ordinary state of a project that
    // has not written a rule yet, and failing here would make `verify` unusable
    // in CI on a fresh install.
    if (json) {
      console.log(JSON.stringify({ ok: true, rules: [] }));
    } else {
      console.log(`No rules found under ${target}.`);
    }
    return;
  }

  const results = [];
  for (const rule of rules) {
    results.push(await run(cwd, rule));
  }

  const failed = results.filter((result) => !result.ok);

  if (json) {
    console.log(JSON.stringify({ ok: failed.length === 0, rules: results }));
  } else {
    for (const result of results) {
      const mark = result.ok ? "✓" : "✗";
      console.log(`${mark} ${result.engine}/${result.ruleId}`);
      for (const error of result.errors) {
        console.log(`    ${error}`);
      }
    }
    console.log(
      failed.length === 0
        ? `\n${String(results.length)} rule(s) ${label === "verify" ? "verified" : "tested"}.`
        : `\n${String(failed.length)} of ${String(results.length)} rule(s) failed.`
    );
  }

  if (failed.length > 0) process.exitCode = 1;
}

const ruleTargetArguments = {
  dir: {
    type: "string",
    alias: "d",
    description: "Working directory",
  },
  json: {
    type: "boolean",
    description: "Output as JSON",
    default: false,
  },
  path: {
    type: "positional",
    description:
      "Rule directory, engine directory, or .taskless/rules for everything",
    required: false,
  },
} as const;

export const verifyCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Check that a rule has the components its engine requires",
  },
  args: ruleTargetArguments,
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    await runOverPath({
      cwd,
      // No path means the whole rules tree, which is what CI wants and what an
      // author means when they ask "is everything here valid".
      target: args.path ?? ".taskless/rules",
      json: args.json,
      label: "verify",
      run: verifyOneRule,
    });
  },
});

export const testCommand = defineCommand({
  meta: {
    name: "test",
    description: "Run a rule's tests, after verifying the rule itself",
  },
  args: ruleTargetArguments,
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    await runOverPath({
      cwd,
      target: args.path ?? ".taskless/rules",
      json: args.json,
      label: "test",
      run: testOneRule,
    });
  },
});
