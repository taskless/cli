import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Reference } from "../src/rules/reference";
import { findValeBinary } from "../src/rules/vale/binary";
import { verifyRule } from "../src/rules/verify";
import { verifyValeRule } from "../src/rules/vale/verify";

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
