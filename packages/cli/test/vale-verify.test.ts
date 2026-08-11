import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import {
  buildIsolatingConfig,
  discoverValeRuleTests,
  verifyValeRule,
  verifyValeRules,
} from "../src/rules/vale/verify";

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (workspaces.length > 0) {
    rmSync(workspaces.pop() as string, { recursive: true, force: true });
  }
});

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
  mkdirSync(join(cwd, ".taskless", "vale", "rules"), { recursive: true });
  for (const [name, body] of Object.entries(rules)) {
    writeFileSync(join(cwd, ".taskless", "vale", "rules", `${name}.yml`), body);
  }
  for (const [ruleId, buckets] of Object.entries(fixtures)) {
    for (const bucket of ["pass", "fail"] as const) {
      const documents = buckets[bucket];
      if (documents === undefined) continue;
      const directory = join(
        cwd,
        ".taskless",
        "vale",
        "rule-tests",
        ruleId,
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
    expect(config).toContain("rules.no-simply = YES");
    // Precedence is positional, so a repeated assignment would be relying on
    // the very rule that bit the scoping spec.
    expect(config.match(/rules\.no-simply/g)).toHaveLength(1);
    expect(config.match(/^\[.*]$/gm)).toHaveLength(1);
  });

  it("uses an absolute StylesPath, since the config lives in a temp dir", () => {
    const config = buildIsolatingConfig("/proj", "no-simply");
    expect(config).toContain("StylesPath = /proj/.taskless/vale");
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
      empty: false,
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
        },
      }
    );
    const result = await verifyValeRule(cwd, "no-simply");
    if ("unavailable" in result) throw new Error("expected a verification");
    expect(result.passed).toBe(false);
    // A fixture that produces nothing is absent from Vale's output entirely,
    // so this can only be caught by comparing against the files on disk.
    expect(result.missingFailures).toEqual([
      ".taskless/vale/rule-tests/no-simply/fail/quiet.md",
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
    const result = await verifyValeRule(cwd, "no-simply");
    if ("unavailable" in result) throw new Error("expected a verification");
    expect(result.passed).toBe(false);
    expect(result.unexpectedFindings).toEqual([
      ".taskless/vale/rule-tests/no-simply/pass/oops.md",
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
    const result = await verifyValeRule(cwd, "no-simply");
    if ("unavailable" in result) throw new Error("expected a verification");
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
    const result = await verifyValeRule(cwd, "no-simply");
    if ("unavailable" in result) throw new Error("expected a verification");
    expect(result.empty).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("needs no committed .vale.ini", async () => {
    // The spec is explicit that rule-tests hold fixtures only; the config is
    // generated. makeProject never writes one.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      { "no-simply": { fail: { "a.md": "Just simply do it.\n" } } }
    );
    const result = await verifyValeRule(cwd, "no-simply");
    if ("unavailable" in result) throw new Error("expected a verification");
    expect(result.passed).toBe(true);
  });
});

withVale("verifyValeRules", () => {
  it("verifies every rule that has fixtures", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": { fail: { "a.md": "Just simply do it.\n" } },
        "no-very": { fail: { "a.md": "It is very good.\n" } },
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

    const cwd = makeProject(
      { "no-simply": existence("simply") },
      { "no-simply": { fail: { "a.md": "Just simply do it.\n" } } }
    );
    const outcome = await verifyValeRules(cwd);
    expect(outcome.status).toBe("unavailable");
  });
});
