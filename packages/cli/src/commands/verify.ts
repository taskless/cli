import { resolve } from "node:path";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { requireCurrentSchema } from "../filesystem/migrate";
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
import { outputSchema as verifyTestOutputSchema } from "../schemas/verify-test";
import { makeErrorEnvelope, writeJsonError } from "../types/errors";
import { CLIError } from "../util/cli-error";

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

  // REFUSES rather than migrates, for both `verify` and `test`.
  //
  // A current layout is still a precondition — a path means nothing against
  // the wrong tree — but establishing it by migrating made two reporting
  // commands rewrite the repository. `0005` moves and deletes tracked files,
  // and it happened with nothing on the human path to say so, landing in
  // whatever commit came next.
  //
  // A wall the user meets once after an upgrade is the visible version of the
  // same cost, and it is the trade this CLI already makes elsewhere: refuse,
  // and name the thing that fixes it.
  try {
    await requireCurrentSchema(cwd);
  } catch (error) {
    if (error instanceof CLIError) {
      if (json) {
        writeJsonError(error.code ?? "INTERNAL_ERROR", error.message);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  // Still creates a scaffold that is absent. That writes a fresh directory
  // rather than rewriting an existing one, so it is not the refusal above.
  //
  // The notice stays suppressed under `--json`. Scaffolding a brand-new
  // project runs every migration from 0, and its file-by-file summary went to
  // stderr unconditionally once this call lost its handler — handing a machine
  // consumer prose it cannot parse, on the one path that still writes.
  await ensureTasklessDirectory(cwd, {
    onNotice: (message: string) => {
      if (!json) console.error(message);
    },
  });

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
      console.log(
        JSON.stringify(
          verifyTestOutputSchema.parse({
            ok: true,
            rules: [],
          })
        )
      );
    } else {
      console.log(`No rules found under ${target}.`);
    }
    return;
  }

  const results: (RuleVerification | RuleTestResult)[] = [];
  for (const rule of rules) {
    results.push(await run(cwd, rule));
  }

  // Three outcomes, not two. A run the execution policy refused is neither a
  // pass nor a failure: the rule is not defective, and no action available to
  // its holder would make a failure green, so failing it would turn `test` red
  // for every project holding a runtime rule. It is excluded from the failures
  // that set the exit code and from the count of rules tested, and gets its
  // own marker below.
  const isRefused = (result: RuleVerification | RuleTestResult): boolean =>
    "refused" in result && result.refused !== undefined;
  const refused = results.filter((result) => isRefused(result));
  const failed = results.filter((result) => !result.ok && !isRefused(result));
  const tested = results.length - refused.length;

  if (json) {
    console.log(
      JSON.stringify(
        verifyTestOutputSchema.parse({
          ok: failed.length === 0,
          rules: results,
        })
      )
    );
  } else {
    for (const result of results) {
      // `○` is neither tick nor cross on purpose: the rule was not tested, and
      // a reader scanning the column has to be able to see that at a glance.
      // The reason prints below it, from `errors`, and names what would run it.
      const mark = isRefused(result) ? "○" : result.ok ? "✓" : "✗";
      console.log(`${mark} ${result.engine}/${result.ruleId}`);
      for (const error of result.errors) {
        console.log(`    ${error}`);
      }
      // Printed even when the rule passed. A misplaced `.vale.ini` assignment
      // makes Vale exit zero having enabled nothing, so the clean line above
      // is exactly the moment the author needs to hear this.
      if ("notice" in result && result.notice !== undefined) {
        console.log(`    notice: ${result.notice}`);
      }
    }
    // A rule that did not run is not among the rules tested. Counting it there
    // is the summary half of the same defect as the tick: "1 rule(s) tested"
    // about a rule nothing ran.
    const notRun =
      refused.length === 0
        ? ""
        : ` ${String(refused.length)} rule(s) did not run.`;
    console.log(
      failed.length === 0
        ? `\n${String(tested)} rule(s) ${label === "verify" ? "verified" : "tested"}.${notRun}`
        : `\n${String(failed.length)} of ${String(tested)} rule(s) failed.${notRun}`
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
  args: {
    ...ruleTargetArguments,
    // The same flag `check` carries, spelled the same way. Here it is the ONLY
    // thing that runs a runtime rule's fixtures: `test` does not reconcile, so
    // there is no blessed-signature path that runs them without it. That makes
    // this stricter than `check`, not looser — `check` will execute a blessed
    // rule with no flag at all, because it runs rules as a side effect of
    // scanning, whereas nothing runs under `test` unless it is asked for twice.
    "dangerously-run-scripts": {
      type: "boolean",
      description:
        "Run runtime-rule check.ts fixtures, which executes untrusted code",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const dangerouslyRunScripts = Boolean(args["dangerously-run-scripts"]);
    // Warned once for the whole run, not once per rule: a tree of runtime rules
    // is one decision by the user, and repeating the sentence per rule teaches
    // people to scroll past it. On stderr, and suppressed under `--json` for
    // `check`'s reason: a machine consumer cannot read prose.
    let warned = false;
    await runOverPath({
      cwd,
      target: args.path ?? ".taskless/rules",
      json: args.json,
      label: "test",
      run: async (ruleCwd, rule) =>
        testOneRule(ruleCwd, rule, {
          dangerouslyRunScripts,
          onRuntimeWarning: (message: string) => {
            if (warned || args.json) return;
            warned = true;
            console.error(message);
          },
        }),
    });
  },
});
