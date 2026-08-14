import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import {
  buildIsolatingConfig,
  discoverValeRuleTests,
  type ValeRunFailure,
  type ValeRuleVerification,
  verifyValeRule,
  verifyValeRules,
} from "../src/rules/vale/verify";

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/**
 * Narrow away the non-`ok` Vale outcomes, which are a broken test environment
 * rather than anything under test — and name the one that arrived, so a Vale
 * that times out here does not look like a verifier that returned the wrong
 * shape.
 */
function verification(
  result: ValeRuleVerification | { outcome: ValeRunFailure }
): ValeRuleVerification {
  if ("outcome" in result) {
    throw new Error(
      `expected a verification, got Vale ${result.outcome.status}`
    );
  }
  return result;
}

interface RuleFixtures {
  pass?: Record<string, string>;
  fail?: Record<string, string>;
}

/** A project with rules and per-rule fixture buckets, and no committed config. */
function makeProject(
  rules: Record<string, string>,
  fixtures: Record<string, RuleFixtures>
): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-verify-"));
  workspaces.push(cwd);
  // A rule is a directory; each `write` below creates its own.
  for (const [name, body] of Object.entries(rules)) {
    mkdirSync(join(cwd, ".taskless", "rules", "vale", name), { recursive: true });
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", name, `${name}.yml`),
      body
    );
  }
  for (const [ruleId, buckets] of Object.entries(fixtures)) {
    for (const bucket of ["pass", "fail"] as const) {
      const documents = buckets[bucket];
      if (documents === undefined) continue;
      const directory = join(
        cwd,
        ".taskless",
        "rules",
        "vale",
        ruleId,
        ".tests",
        bucket
      );
      mkdirSync(directory, { recursive: true });
      for (const [name, body] of Object.entries(documents)) {
        writeFileSync(join(directory, name), body);
      }
    }
  }
  return cwd;
}

const existence = (token: string) =>
  `extends: existence\nmessage: "Avoid '${token}'"\nlevel: warning\ntokens:\n  - ${token}\n`;

describe("buildIsolatingConfig", () => {
  it("enables exactly one rule, once", () => {
    const config = buildIsolatingConfig("/proj", "no-simply");
    expect(config).toContain("no-simply.no-simply = YES");
    // Precedence is positional, so a repeated assignment would be relying on
    // the very rule that bit the scoping spec.
    expect(config.match(/no-simply\.no-simply/g)).toHaveLength(1);
    expect(config.match(/^\[.*]$/gm)).toHaveLength(1);
  });

  it("uses an absolute StylesPath, since the config lives in a temp dir", () => {
    const config = buildIsolatingConfig("/proj", "no-simply");
    expect(config).toContain("StylesPath = /proj/.taskless/rules/vale");
  });

  it("loads no bundled styles", () => {
    // Without this a fixture could trip Vale.Spelling and be counted as the
    // rule under test firing.
    expect(buildIsolatingConfig("/proj", "r")).toContain("BasedOnStyles =");
  });
});

describe("discoverValeRuleTests", () => {
  it("lists rule ids that have a fixture directory", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": { fail: { "a.md": "Just simply do it.\n" } },
        "no-very": { fail: { "a.md": "It is very good.\n" } },
      }
    );
    expect(await discoverValeRuleTests(cwd)).toEqual(["no-simply", "no-very"]);
  });

  it("returns nothing when the directory does not exist", async () => {
    const cwd = makeProject({ r: existence("simply") }, {});
    expect(await discoverValeRuleTests(cwd)).toEqual([]);
  });
});

// Root ignores the mode bits, so there is no unreadable directory to make.
const asUser = process.getuid?.() === 0 ? describe.skip : describe;

asUser("verifyValeRule with an unreadable bucket", () => {
  it("surfaces the IO error instead of reading it as an empty bucket", async () => {
    // The buckets are read independently: swallowing this would leave `pass/`
    // silently `[]` beside a populated `fail/`, and the rule could report
    // passing having never checked the pass side.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const passDirectory = join(
      cwd,
      ".taskless",
      "rules",
      "vale",
      "no-simply",
      ".tests",
      "pass"
    );
    chmodSync(passDirectory, 0o000);
    try {
      await expect(verifyValeRule(cwd, "no-simply")).rejects.toThrow(/EACCES/);
    } finally {
      // Restore, or the afterEach cleanup cannot recurse into it either.
      chmodSync(passDirectory, 0o700);
    }
  });
});

describe("fixture buckets are flat", () => {
  it("rejects a nested directory instead of silently skipping it", async () => {
    // The dangerous case: Vale lints the rule's `.tests/` recursively, so a
    // nested fixture IS linted, but a flat read never collects it. Skipping it
    // quietly would let a nested `pass/` fixture fire with its finding
    // discarded, and a nested `fail/` fixture never be required to fire —
    // `passed: true` over fixtures that were never checked.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          pass: { "clean.md": "Nothing objectionable.\n" },
          fail: { "a.md": "Just simply do it.\n" },
        },
      }
    );
    mkdirSync(join(cwd, ".taskless", "rules", "vale", "no-simply", ".tests", "pass", "nested"), {
      recursive: true,
    });

    await expect(verifyValeRule(cwd, "no-simply")).rejects.toThrow(
      /fixture buckets are flat/i
    );
  });
});

withVale("verifyValeRule", () => {
  it("passes when every fail fixture fires and every pass fixture is clean", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: {
            "a.md": "Just simply do it.\n",
            "b.md": "Keep it simply short.\n",
          },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const result = await verifyValeRule(cwd, "no-simply");
    expect(result).toEqual({
      ruleId: "no-simply",
      passed: true,
      missingFailures: [],
      unexpectedFindings: [],
      fixtures: "both",
    });
  });

  it("reports a fail fixture that does not fire", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: {
            "a.md": "Just simply do it.\n",
            "quiet.md": "Nothing here.\n",
          },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    // A fixture that produces nothing is absent from Vale's output entirely,
    // so this can only be caught by comparing against the files on disk.
    expect(result.missingFailures).toEqual([
      ".taskless/rules/vale/no-simply/.tests/fail/quiet.md",
    ]);
  });

  it("reports a pass fixture that fires", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "oops.md": "This simply fires.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    expect(result.unexpectedFindings).toEqual([
      ".taskless/rules/vale/no-simply/.tests/pass/oops.md",
    ]);
  });

  it("isolates the rule under test from every other rule", async () => {
    // The pass fixture trips a DIFFERENT rule. Without isolation that finding
    // would be counted and the fixture reported as wrongly firing — a
    // verification failure for a rule that behaved correctly.
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "b.md": "It is very fine.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(true);
    expect(result.unexpectedFindings).toEqual([]);
  });

  it("does not report success for a rule with no fixtures", async () => {
    // An empty fixture directory proves nothing. Reporting it as passing is
    // how an unverified rule ships looking verified.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {},
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.fixtures).toBe("none");
    expect(result.passed).toBe(false);
  });

  it("does not report success for a rule with only fail fixtures", async () => {
    // The rule is shown to fire and never shown not to over-fire. Half a
    // claim, and it is not "empty" — without this it would report passing on
    // an unexpectedFindings that had nothing to check.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      { "no-simply": { fail: { "a.md": "Just simply do it.\n" } } }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.fixtures).toBe("fail-only");
    expect(result.passed).toBe(false);
  });

  it("does not report success for a rule with only pass fixtures", async () => {
    // The more misleading half: `missingFailures` is trivially empty, so this
    // used to pass without ever demonstrating the rule can fire at all.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      { "no-simply": { pass: { "c.md": "Nothing objectionable.\n" } } }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.fixtures).toBe("pass-only");
    expect(result.passed).toBe(false);
  });

  it("needs no committed .vale.ini", async () => {
    // The spec is explicit that rule-tests hold fixtures only; the config is
    // generated. makeProject never writes one.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(true);
  });
});

withVale("verifyValeRules", () => {
  it("verifies every rule that has fixtures", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
        "no-very": {
          fail: { "a.md": "It is very good.\n" },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const outcome = await verifyValeRules(cwd);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.rules.map((rule) => [rule.ruleId, rule.passed])).toEqual([
      ["no-simply", true],
      ["no-very", true],
    ]);
  });
});

describe("verifyValeRules without a binary", () => {
  it("reports unavailable rather than failing every rule", async () => {
    // With no binary every rule produces no findings, which is
    // indistinguishable from every rule being broken. Reporting a wall of
    // verification failures would send someone to debug rules over a missing
    // install.
    const binary = await import("../src/rules/vale/binary");
    vi.spyOn(binary, "findValeBinary").mockReturnValue({
      path: undefined,
      tried: ["@taskless/vale-darwin-arm64", "PATH"],
    });

    // Both buckets, or the rule short-circuits on incomplete fixtures and Vale
    // is never invoked — the binary's absence would go unnoticed.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "a.md": "Just simply do it.\n" },
          pass: { "c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const outcome = await verifyValeRules(cwd);
    expect(outcome.status).toBe("unavailable");
  });
});
