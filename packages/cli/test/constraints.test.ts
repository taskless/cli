import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { RULE_CONSTRAINTS, type RuleViolation } from "../src/rules/constraints";
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
 *
 * ## Why each case asserts on the error TEXT, not just `ok: false`
 *
 * A rejection is not evidence that the documented check is what rejected. Two
 * of these scenarios were refused for unrelated reasons and still passed:
 * `sg-files-globs-parse` wrote its `files:` array through a hand-rolled
 * serializer that emitted a `0:` mapping key whose value began with `*`, which
 * YAML reads as an alias, so the rule was refused as malformed before any glob
 * was examined; `sg-fixture-id-matches-rule` shipped a fixture with only a
 * `valid:` bucket, which fails coverage whether or not the id excluded it.
 * Both would have kept passing with the check they name deleted, which is the
 * exact staleness this file exists to catch, so every case now names a string
 * only its own constraint produces.
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
}): Promise<{ ok: boolean; errors: string[]; violations: RuleViolation[] }> {
  const ruleId = options.directoryName ?? "probe-rule";
  const directory = join(project, ".taskless/rules/sg", ruleId);
  await mkdir(join(directory, ".tests"), { recursive: true });

  // Serialized by the same library `verify` parses with, rather than by hand.
  // The hand-rolled version treated an array as a mapping and wrote
  // `files:\n  0: **/*.py`, which YAML reads as an unresolved alias: the rule
  // was refused as malformed, and the scenario that meant to probe a glob check
  // never reached one.
  await writeFile(
    join(directory, `${ruleId}.yml`),
    stringify(options.rule ?? VALID_RULE)
  );

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
    return {
      ok: result.ok,
      errors: result.errors,
      violations: result.violations,
    };
  }
  const verification = await verifyOneRule(project, resolved);
  return {
    ok: verification.ok,
    errors: verification.errors,
    violations: verification.violations,
  };
}

/**
 * The scenario that must violate each documented constraint.
 *
 * `names` is text only THIS constraint's refusal produces, so a scenario that
 * starts failing for an unrelated reason fails the suite instead of passing
 * quietly.
 */
interface Scenario {
  run: () => Promise<{
    ok: boolean;
    errors: string[];
    violations: RuleViolation[];
  }>;
  names: RegExp;
}

const VIOLATIONS: Record<string, Scenario> = {
  "sg-id-matches-directory": {
    run: () =>
      verifyWritten({
        directoryName: "probe-rule-20260101",
        rule: { ...VALID_RULE, id: "probe-rule" },
        fixture:
          "id: probe-rule-20260101\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n",
      }),
    names: /does not match the rule's directory/,
  },
  "sg-regex-needs-kind": {
    run: () =>
      verifyWritten({
        rule: { ...VALID_RULE, rule: { regex: "^eval$" } },
        fixture: VALID_FIXTURE,
      }),
    names: /uses "regex" without a sibling "kind" field/,
  },
  "sg-language-accepted": {
    run: () =>
      verifyWritten({
        rule: { ...VALID_RULE, language: "Typescriptt" },
        fixture: VALID_FIXTURE,
      }),
    names: /is not a language ast-grep [\d.]+ accepts/,
  },
  // `**/*.tsx` under TypeScript, not an arbitrary foreign extension. The check
  // is the ts/tsx sibling trap and nothing wider: with `**/*.py` the rule is
  // ACCEPTED, because ast-grep's schema couples no extension to a language and
  // nothing in either layer compares the two in general.
  "sg-files-globs-parse": {
    run: () =>
      verifyWritten({
        rule: { ...VALID_RULE, files: ["**/*.tsx"] },
        fixture: VALID_FIXTURE,
      }),
    names: /every glob names \.tsx, but language is TypeScript/,
  },
  "sg-required-fields": {
    run: () =>
      verifyWritten({
        rule: {
          id: "probe-rule",
          language: "TypeScript",
          rule: { pattern: "eval($A)" },
        },
        fixture: VALID_FIXTURE,
      }),
    names: /Missing required field/,
  },
  "sg-test-file-required": {
    run: () => verifyWritten({ fixture: undefined }),
    names: /No test file found for rule/,
  },
  // The fixture carries BOTH buckets under the wrong id. With only `valid:` it
  // fails coverage as "half a claim" whether or not the id excluded it, so the
  // scenario would still be red with the attribution check deleted. Complete
  // buckets make "no fixtures" reachable only by exclusion: attribute this file
  // and coverage is `both`, and the rule passes.
  "sg-fixture-id-matches-rule": {
    run: () =>
      verifyWritten({
        layer: "test",
        fixture:
          "id: some-other-rule\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n",
      }),
    names: /has no fixtures, so nothing shows it fires or stays quiet/,
  },
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
      const scenario = VIOLATIONS[id];
      expect(scenario, `no scenario for ${id}`).toBeDefined();
      const result = await scenario!.run();
      expect(
        result.ok,
        `${id} is documented but verify accepted a rule that violates it`
      ).toBe(false);
      // The refusal must be THIS constraint's. Without this, a scenario that
      // breaks in some unrelated way goes on passing and the entry it guards
      // is unguarded.
      expect(
        result.errors.join("\n"),
        `${id} was refused, but not by the check it documents`
      ).toMatch(scenario!.names);

      // And the refusal SAYS which constraint it is, so a consumer maps it to
      // the rationale we publish instead of matching on our wording. The two
      // assertions are not redundant: the one above proves the right check
      // fired, this one proves the result reports it.
      const attributed = result.violations.filter(
        (violation) => violation.constraintId === id
      );
      expect(
        attributed.length,
        `${id} fired but the result attributes it to ${JSON.stringify(
          result.violations.map((violation) => violation.constraintId)
        )}`
      ).toBeGreaterThan(0);

      // The message is repeated verbatim rather than joined to `errors` by
      // index, which is what lets a consumer ignore `errors` entirely.
      for (const violation of attributed) {
        expect(result.errors).toContain(violation.message);
      }
    }
  );

  it("leaves a failure no constraint describes unattributed", async () => {
    // Malformed YAML is a real refusal that no published constraint explains.
    // Giving it the nearest plausible id would send a reader to a rationale
    // that does not describe their failure, which is worse than none.
    const ruleId = "probe-rule";
    const directory = join(project, ".taskless/rules/sg", ruleId);
    await mkdir(join(directory, ".tests"), { recursive: true });
    await writeFile(join(directory, `${ruleId}.yml`), "id: [unclosed\n");
    await writeFile(
      join(directory, ".tests", `${ruleId}-test.yml`),
      VALID_FIXTURE
    );

    const result = await verifyOneRule(project, { engine: "sg", ruleId });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Invalid YAML/);
    expect(result.violations).toEqual([]);
  });

  it("distinguishes an unwritten fixture from one excluded by its id", async () => {
    // Both reach `test` as "no fixtures", and they want different advice: one
    // author has written nothing, the other has a file sitting right there
    // that is silently not counted. Only the second is this constraint.
    const excluded = await verifyWritten({
      layer: "test",
      fixture:
        "id: some-other-rule\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n",
    });
    expect(
      excluded.violations.map((violation) => violation.constraintId)
    ).toContain("sg-fixture-id-matches-rule");

    // An empty-but-correctly-attributed fixture file fails the same way and is
    // NOT an id mismatch. Attributing it would send the author looking for a
    // wrong id in a file whose id is right.
    const empty = await verifyWritten({
      layer: "test",
      fixture: "id: probe-rule\n",
    });
    expect(empty.ok).toBe(false);
    expect(empty.errors.join("\n")).toMatch(/has no fixtures/);
    expect(
      empty.violations.map((violation) => violation.constraintId)
    ).not.toContain("sg-fixture-id-matches-rule");
  });

  it("does not blame an id mismatch for a shortfall fixing the id would not fix", async () => {
    // `fixturesExcludedById` is rule-wide, but coverage is the sum over every
    // discovered file, so the two can disagree. Here one file carries the right
    // id and one carries the wrong one, and NEITHER has an `invalid:` bucket:
    // combined coverage is `valid-only`, not `none`. Correcting the id would
    // leave that shortfall exactly where it is, so attributing it to
    // `sg-fixture-id-matches-rule` would send the author to an unrelated
    // mismatch while the missing half of the claim goes unmentioned. This test
    // catches a gate that reads only the flag.
    const ruleId = "probe-rule";
    const directory = join(project, ".taskless/rules/sg", ruleId);
    await mkdir(join(directory, ".tests"), { recursive: true });
    await writeFile(join(directory, `${ruleId}.yml`), stringify(VALID_RULE));
    // Both filenames match the `<ruleId>-*-test.yml` discovery pattern, so both
    // are found; only the second is excluded, and only by its `id:`.
    await writeFile(
      join(directory, ".tests", `${ruleId}-a-test.yml`),
      "id: probe-rule\nvalid:\n  - const a = 1;\n"
    );
    await writeFile(
      join(directory, ".tests", `${ruleId}-b-test.yml`),
      "id: some-other-rule\nvalid:\n  - const b = 2;\n"
    );

    const result = await testOneRule(project, { engine: "sg", ruleId });
    expect(result.ok, result.errors.join("; ")).toBe(false);
    expect(result.errors.join("\n")).toMatch(/only valid: fixtures/);
    expect(result.errors.join("\n")).toMatch(/half a claim/);
    expect(
      result.violations.map((violation) => violation.constraintId)
    ).not.toContain("sg-fixture-id-matches-rule");
  });

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
    // A rule that passed broke no constraint. Reporting one here would make
    // `violations` unreadable as "what generation must learn".
    expect(result.violations).toEqual([]);
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
