import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULE_CONSTRAINTS } from "../src/rules/demo/constraints";
import { testOneRule, verifyOneRule } from "../src/rules/inspect";

/**
 * Every documented constraint is a check that still fires.
 *
 * A hand-maintained description of what code does goes stale, and this list is
 * published for another team to build an eval against, so staleness here is
 * exported rather than merely internal. `create-sg-rule.txt` claimed for months
 * that "`verify` never reads `language`" after that stopped being true, and
 * nothing failed, because prose has no test.
 *
 * Each case below writes a rule violating one constraint and asserts `verify`
 * refuses it. The mapping is by constraint `id`, so a documented check that
 * stops firing fails here by name.
 */

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "tskl-constraint-"));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const VALID_RULE = {
  id: "probe-rule",
  language: "TypeScript",
  severity: "error",
  message: "no eval",
  rule: { pattern: "eval($ARG)" },
};

const VALID_FIXTURE = [
  "id: probe-rule",
  "valid:",
  "  - const a = 1;",
  "invalid:",
  "  - eval(x);",
  "",
].join("\n");

/** Write one sg rule directory, then run layers 1 and 2 over it. */
async function verifyWritten(options: {
  directoryName?: string;
  rule?: Record<string, unknown>;
  fixture?: string | undefined;
  layer?: "verify" | "test";
}): Promise<{ ok: boolean; errors: string[] }> {
  const ruleId = options.directoryName ?? "probe-rule";
  const directory = join(project, ".taskless/rules/sg", ruleId);
  await mkdir(join(directory, ".tests"), { recursive: true });

  const body = options.rule ?? VALID_RULE;
  const lines = Object.entries(body).map(([key, value]) =>
    typeof value === "object"
      ? `${key}:\n  ${Object.entries(value as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join("\n  ")}`
      : `${key}: ${JSON.stringify(value)}`
  );
  await writeFile(join(directory, `${ruleId}.yml`), `${lines.join("\n")}\n`);

  if (options.fixture !== undefined) {
    await writeFile(
      join(directory, ".tests", `${ruleId}-test.yml`),
      options.fixture
    );
  }

  // Through the command entry points a user actually runs, not through
  // `verifyRule` directly. The fixture-attribution rule is decided by the
  // coverage classification that `testOneRule` composes on top of the raw
  // layers, so asserting against `verifyRule.tests` reported `valid: true` for
  // a rule with no attributable cases: ast-grep found the rule, had nothing to
  // run for it, and exited 0. The layer boundary is not where it looks.
  const resolved = { engine: "sg" as const, ruleId };
  if (options.layer === "test") {
    const result = await testOneRule(project, resolved);
    return { ok: result.ok, errors: result.errors };
  }
  const verification = await verifyOneRule(project, resolved);
  return { ok: verification.ok, errors: verification.errors };
}

/** The scenario that must violate each documented constraint. */
const VIOLATIONS: Record<
  string,
  () => Promise<{ ok: boolean; errors: string[] }>
> = {
  "sg-id-matches-directory": () =>
    verifyWritten({
      directoryName: "probe-rule-20260101",
      rule: { ...VALID_RULE, id: "probe-rule" },
      fixture: "id: probe-rule-20260101\nvalid:\n  - const a = 1;\n",
    }),
  "sg-regex-needs-kind": () =>
    verifyWritten({
      rule: { ...VALID_RULE, rule: { regex: "^eval$" } },
      fixture: VALID_FIXTURE,
    }),
  "sg-language-accepted": () =>
    verifyWritten({
      rule: { ...VALID_RULE, language: "Typescriptt" },
      fixture: VALID_FIXTURE,
    }),
  "sg-files-globs-parse": () =>
    verifyWritten({
      rule: { ...VALID_RULE, files: ["**/*.py"] },
      fixture: VALID_FIXTURE,
    }),
  "sg-required-fields": () =>
    verifyWritten({
      rule: {
        id: "probe-rule",
        language: "TypeScript",
        rule: { pattern: "eval($A)" },
      },
      fixture: VALID_FIXTURE,
    }),
  "sg-test-file-required": () => verifyWritten({ fixture: undefined }),
  "sg-fixture-id-matches-rule": () =>
    verifyWritten({
      layer: "test",
      fixture: "id: some-other-rule\nvalid:\n  - const a = 1;\n",
    }),
};

describe("every documented constraint is a check that still fires", () => {
  it("documents no constraint without a scenario, and vice versa", () => {
    expect(RULE_CONSTRAINTS.map((c) => c.id).toSorted()).toEqual(
      Object.keys(VIOLATIONS).toSorted()
    );
  });

  it.each(RULE_CONSTRAINTS.map((c) => [c.id, c.summary] as const))(
    "%s — %s",
    async (id) => {
      const violate = VIOLATIONS[id];
      expect(violate, `no scenario for ${id}`).toBeDefined();
      const result = await violate!();
      expect(
        result.ok,
        `${id} is documented but verify accepted a rule that violates it`
      ).toBe(false);
    }
  );

  it("says which command enforces each, since that decides eval order", () => {
    for (const constraint of RULE_CONSTRAINTS) {
      expect(["verify", "test"]).toContain(constraint.enforcedBy);
    }
  });

  it("accepts the rule every scenario is a mutation of", async () => {
    // Without this the suite above could pass because `verify` rejects
    // everything, which would make each case prove nothing.
    const result = await verifyWritten({ fixture: VALID_FIXTURE });
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});

describe("the constraint list is fit to publish", () => {
  it("gives every entry a stable id, a summary and a rationale", () => {
    for (const constraint of RULE_CONSTRAINTS) {
      expect(constraint.id).toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(constraint.summary.length).toBeGreaterThan(20);
      // The rationale is what lets a reader tell a house rule from a bug, which
      // is the distinction the whole list exists to make.
      expect(constraint.rationale.length).toBeGreaterThan(60);
    }
  });

  it("has no duplicate ids, since consumers branch on them", () => {
    const ids = RULE_CONSTRAINTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
