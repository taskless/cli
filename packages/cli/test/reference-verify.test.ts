import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import type referenceCheck from "../assets/reference-runtime/check";
import type { Reference } from "../src/rules/reference";
import type { Match } from "../src/types/runtime-rule";
import { findValeBinary } from "../src/rules/vale/binary";
import { verifyRule } from "../src/rules/verify";
import { verifyValeRule } from "../src/rules/vale/verify";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);

/**
 * A reference rule passes its own held-out cases.
 *
 * Other teams grade a generated rule by running OUR rule against THEIR cases,
 * so a reference narrower than its prompt marks a correct generation wrong.
 * `prefer-use-over-utilize` shipped with a prompt asking for the inflected
 * forms and a swap that lacked `utilized`, and `no-eval-call` with a prompt
 * asking for any call and a pattern that matched exactly one argument (#591).
 * Nothing ran the reference against its own cases, so nothing noticed. This
 * stages each published entry exactly as a consumer would and verifies it.
 */

const referencePath = join(
  import.meta.dirname,
  "..",
  "assets",
  "reference.json"
);

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/** Write a reference entry's rule and cases into a fresh project. */
function stage(rule: Reference["rules"][number]): string {
  const cwd = mkdtempSync(join(tmpdir(), "taskless-reference-"));
  workspaces.push(cwd);
  for (const file of [...rule.rule, ...rule.tests.files]) {
    const target = join(cwd, rule.directory, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  return cwd;
}

/** Read the published corpus and return its rule for one engine. */
async function referenceRule(
  engine: Reference["rules"][number]["engine"]
): Promise<Reference["rules"][number]> {
  const reference = JSON.parse(
    await readFile(referencePath, "utf8")
  ) as Reference;
  const rule = reference.rules.find((entry) => entry.engine === engine);
  if (rule === undefined) throw new Error(`reference has no ${engine} rule`);
  return rule;
}

describe("the sg reference rule", () => {
  it("fires on every fail case and stays quiet on every pass case", async () => {
    const rule = await referenceRule("sg");

    const result = await verifyRule(stage(rule), rule.id);

    expect(result.tests.errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});

withVale("the vale reference rule", () => {
  it("fires on every fail case and stays quiet on every pass case", async () => {
    const rule = await referenceRule("vale");

    const result = await verifyValeRule(stage(rule), rule.id);
    if ("outcome" in result) {
      throw new Error(
        `expected a verification, got Vale ${result.outcome.status}`
      );
    }

    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("the runtime reference rule", () => {
  it("declares every match field the harness passes, but the id", () => {
    // A check copied from the reference starts from this interface, so a field
    // missing here is one a new check cannot see without a cast. `text` was
    // missing, and a capture with no metavariable has nothing else to read
    // (taskless/cli#654). `ruleId` stays out on purpose: a check branches on
    // the name. Enforced by `pnpm typecheck`; a no-op at run time.
    expectTypeOf<Parameters<typeof referenceCheck>[1][number]>().toEqualTypeOf<
      Omit<Match, "ruleId">
    >();
  });

  it("fires on every fail case and stays quiet on every pass case", async () => {
    const rule = await referenceRule("runtime");
    const cwd = stage(rule);
    await execFileAsync("node", [builtCli(), "init", "-d", cwd]);

    // `verify` executes a runtime rule's check only under the flag. A failing
    // run exits non-zero, which `execFile` rejects with, so read the report
    // from whichever side it lands on.
    const { stdout } = await execFileAsync("node", [
      builtCli(),
      "verify",
      rule.directory,
      "-d",
      cwd,
      "--json",
      "--dangerously-run-scripts",
    ]).catch((error: unknown) => error as { stdout: string });
    const report = JSON.parse(stdout) as {
      ok: boolean;
      rules: { errors: string[]; cases: { name: string; ok: boolean }[] }[];
    };

    expect(report.rules[0]?.errors).toEqual([]);
    expect(report.ok).toBe(true);
    // The `.tsx` case reaches the check only through the `Tsx` capture: a
    // `TypeScript` capture never reads a `.tsx` file (taskless/cli#654).
    expect(report.rules[0]?.cases).toContainEqual(
      expect.objectContaining({ name: "fail/undeclared-tsx", ok: true })
    );
  });
});
