import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { ENGINE_LAYOUTS } from "../src/rules/layout";
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

/**
 * A rule's fixtures, keyed by `<case>/<path inside the case>`.
 *
 * The case is a directory and the path beneath it is where the document sits
 * relative to the root Vale is run from, which is what a matcher is resolved
 * against: `outside/notes.md` and `inside/docs/guide/notes.md` are two cases
 * whose only difference is the path.
 */
interface RuleFixtures {
  pass?: Record<string, string>;
  fail?: Record<string, string>;
}

/** The matcher every rule gets unless a test names its own. */
const SCOPED = (id: string, matcher = "*.md"): string =>
  `[${matcher}]\ntskl) rule = ${id}\n${id}.${id} = YES\n`;

const ruleDirectory = (cwd: string, ruleId: string): string =>
  join(cwd, ".taskless", "rules", "vale", ruleId);

/** `.taskless/rules/vale/<id>/tests`, project-relative, for asserting on paths. */
const testsPath = (ruleId: string): string =>
  `.taskless/rules/vale/${ruleId}/tests`;

/**
 * A project with rules and per-rule fixture cases.
 *
 * Every rule gets its own `.vale.ini`, `[*.md]` unless `configs` says
 * otherwise: verification runs a case under the rule's own matchers, so a rule
 * without one has no scope to verify under.
 */
function makeProject(
  rules: Record<string, string>,
  fixtures: Record<string, RuleFixtures>,
  configs: Record<string, string> = {}
): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-verify-"));
  workspaces.push(cwd);
  for (const [name, body] of Object.entries(rules)) {
    const directory = ruleDirectory(cwd, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.yml`), body);
    writeFileSync(join(directory, ".vale.ini"), configs[name] ?? SCOPED(name));
  }
  for (const [ruleId, buckets] of Object.entries(fixtures)) {
    for (const bucket of ["pass", "fail"] as const) {
      const documents = buckets[bucket];
      if (documents === undefined) continue;
      const directory = join(ruleDirectory(cwd, ruleId), "tests", bucket);
      mkdirSync(directory, { recursive: true });
      for (const [path, body] of Object.entries(documents)) {
        mkdirSync(dirname(join(directory, path)), { recursive: true });
        writeFileSync(join(directory, path), body);
      }
    }
  }
  return cwd;
}

const existence = (token: string) =>
  `extends: existence\nmessage: "Avoid '${token}'"\nlevel: warning\ntokens:\n  - ${token}\n`;

/** A project whose single rule has both fixture buckets populated. */
function bothBuckets(): string {
  return makeProject(
    { "no-simply": existence("simply") },
    {
      "no-simply": {
        fail: { "a/a.md": "Just simply do it.\n" },
        pass: { "c/c.md": "Nothing objectionable.\n" },
      },
    }
  );
}

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

  it("names no style, and writes no BasedOnStyles line", () => {
    // Measured on Vale 3.21.0 and 3.22.0: a bundled style loads only when a
    // run-level `BasedOnStyles` names one, so a fixture cannot trip
    // `Vale.Spelling` here. The config used to write `BasedOnStyles =` on the
    // opposite belief; since 3.22.0 an empty value clears a file's inherited
    // settings, and the schema refuses it in a rule's own config, so the
    // isolating config no longer writes the shape it refuses.
    expect(buildIsolatingConfig("/proj", "r")).not.toContain("BasedOnStyles");
  });
});

describe("discoverValeRuleTests", () => {
  it("lists rule ids that have a fixture directory", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": { fail: { "a/a.md": "Just simply do it.\n" } },
        "no-very": { fail: { "a/a.md": "It is very good.\n" } },
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
    const cwd = bothBuckets();
    const passDirectory = join(
      ruleDirectory(cwd, "no-simply"),
      "tests",
      "pass"
    );
    chmodSync(passDirectory, 0o000);
    try {
      const result = verification(await verifyValeRule(cwd, "no-simply"));
      expect(result.passed).toBe(false);
      expect(result.errors.join("\n")).toMatch(/EACCES/);
      // Not reported as a half-written rule: `pass-only`/`fail-only` would
      // be the exact misreading this read discipline exists to prevent.
      expect(result.fixtures).not.toBe("fail-only");
    } finally {
      // Restore, or the afterEach cleanup cannot recurse into it either.
      chmodSync(passDirectory, 0o700);
    }
  });
});

describe("a rule's tests/ holds only case directories", () => {
  it("refuses a loose file in a bucket, naming its path", async () => {
    // The engine is run with a case directory as its root, so a bare file in
    // `pass/` has no root to be. Skipping it would leave a fixture an author
    // wrote, that never ran, and that nothing mentioned.
    const cwd = bothBuckets();
    writeFileSync(
      join(ruleDirectory(cwd, "no-simply"), "tests", "pass", "loose.md"),
      "Nothing objectionable.\n"
    );

    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    expect(result.errors.join("\n")).toContain(
      join("no-simply", "tests", "pass", "loose.md")
    );

    // This rejection IS the declared layout, and the conformance corpus
    // publishes that declaration as fact. Asserted here so a reader changing
    // either meets the other.
    expect(ENGINE_LAYOUTS.vale.fixtureLayout).toBe("case-directories");
  });

  it("refuses a stray entry in tests/, naming its path", async () => {
    // A leftover from the old layout, or an engine-native test file, would
    // otherwise sit beside the cases and never run.
    const cwd = bothBuckets();
    writeFileSync(
      join(ruleDirectory(cwd, "no-simply"), "tests", "notes.md"),
      "Just simply do it.\n"
    );

    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    expect(result.errors.join("\n")).toContain(
      join("no-simply", "tests", "notes.md")
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
            "a/a.md": "Just simply do it.\n",
            "b/b.md": "Keep it simply short.\n",
          },
          pass: { "c/c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const result = await verifyValeRule(cwd, "no-simply");
    // Exhaustive on purpose: a field added to the verification shows up here
    // rather than sliding in unasserted. `findings` is spelled out per finding
    // for the same reason, and because `file` is the project-relative path of
    // the fixture document, case directory included, with its bucket beside it.
    expect(result).toEqual({
      ruleId: "no-simply",
      passed: true,
      missingFailures: [],
      unexpectedFindings: [],
      errors: [],
      fixtures: "both",
      notices: [],
      findings: [
        {
          source: "vale",
          ruleId: "no-simply",
          severity: "warning",
          message: "Avoid 'simply'",
          file: `${testsPath("no-simply")}/fail/a/a.md`,
          range: {
            start: { line: 0, column: 5 },
            end: { line: 0, column: 10 },
          },
          matchedText: "simply",
          bucket: "fail",
        },
        {
          source: "vale",
          ruleId: "no-simply",
          severity: "warning",
          message: "Avoid 'simply'",
          file: `${testsPath("no-simply")}/fail/b/b.md`,
          range: {
            start: { line: 0, column: 8 },
            end: { line: 0, column: 13 },
          },
          matchedText: "simply",
          bucket: "fail",
        },
      ],
    });
  });

  it("reports a fail fixture that does not fire", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: {
            "a/a.md": "Just simply do it.\n",
            "quiet/quiet.md": "Nothing here.\n",
          },
          pass: { "c/c.md": "Nothing objectionable.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    // A case that produces nothing is absent from Vale's output entirely, so
    // this can only be caught by comparing against the cases on disk.
    expect(result.missingFailures).toEqual([
      `${testsPath("no-simply")}/fail/quiet/`,
    ]);
    // Quiet with the scope removed too, so the pattern is what is blamed.
    expect(result.errors).toEqual([
      `fail case did not fire: ${testsPath("no-simply")}/fail/quiet/ (the rule did not match it)`,
    ]);
  });

  it("reports a pass fixture that fires, under the pass bucket", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "a/a.md": "Just simply do it.\n" },
          pass: { "oops/oops.md": "This simply fires.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    expect(result.unexpectedFindings).toEqual([
      `${testsPath("no-simply")}/pass/oops/`,
    ]);
    expect(
      result.findings
        .filter((finding) => finding.bucket === "pass")
        .map((finding) => finding.file)
    ).toEqual([`${testsPath("no-simply")}/pass/oops/oops.md`]);
  });

  it("isolates the rule under test from every other rule", async () => {
    // The pass fixture trips a DIFFERENT rule. Without isolation that finding
    // would be counted and the fixture reported as wrongly firing — a
    // verification failure for a rule that behaved correctly.
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": {
          fail: { "a/a.md": "Just simply do it.\n" },
          pass: { "b/b.md": "It is very fine.\n" },
        },
      }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(true);
    expect(result.unexpectedFindings).toEqual([]);
  });

  it("is not failed by another rule whose .vale.ini is rejected", async () => {
    // `check` refuses the whole Vale assembly over one rejected config, on
    // purpose. Verification builds its config from the rule under test alone,
    // so a sibling's broken config cannot fail this rule's cases.
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": {
          fail: { "a/a.md": "Just simply do it.\n" },
          pass: { "c/c.md": "Nothing objectionable.\n" },
        },
      },
      // No breadcrumb, and it assigns another rule's key: refused twice over.
      { "no-very": "[*.md]\nno-simply.no-simply = NO\n" }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
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
      { "no-simply": { fail: { "a/a.md": "Just simply do it.\n" } } }
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
      { "no-simply": { pass: { "c/c.md": "Nothing objectionable.\n" } } }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.fixtures).toBe("pass-only");
    expect(result.passed).toBe(false);
  });

  it("excludes a fixture with unparseable front matter instead of blocking every other fixture (taskless/cli#300)", async () => {
    // Each case is its own Vale run with the case as the working directory,
    // so a malformed document reports a config-error `Path` relative to the
    // case. `targetFileParseError` must still recognize it as a target file,
    // or that one case returns `{ outcome: { status: "failed" } }` for the
    // WHOLE rule and neither `a/` nor `c/` below is ever evaluated.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: {
            "a/a.md": "Just simply do it.\n",
            "bad/bad.md":
              "---\ndescription: has a colon: right here\n---\n\nJust simply do it.\n",
          },
          pass: { "c/c.md": "Nothing objectionable.\n" },
        },
      }
    );

    const result = verification(await verifyValeRule(cwd, "no-simply"));

    // The good cases are still evaluated normally: `a/` fires, `c/` stays
    // clean.
    expect(result.missingFailures).not.toContain(
      `${testsPath("no-simply")}/fail/a/`
    );
    expect(result.unexpectedFindings).toEqual([]);
    // `bad.md` could not be parsed, so it never fires under its own rule id —
    // it is reported as a missing failure rather than silently dropped, and
    // rather than taking `a/` and `c/` down with it.
    expect(result.missingFailures).toContain(
      `${testsPath("no-simply")}/fail/bad/`
    );
    expect(result.passed).toBe(false);
  });
});

withVale("verifyValeRule applies the rule's own matchers", () => {
  // The rule is enabled only under `[docs/**/*.md]`. Verification used to
  // enable it under `[*]`, so a rule whose matchers matched nothing real
  // passed verification and stayed silent in `check`.
  const DOCS_ONLY = SCOPED("no-simply", "docs/**/*.md");

  it("fires on a case document at a path the matcher admits", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "inside/docs/guide/notes.md": "Just simply do it.\n" },
          pass: { "clean/docs/guide/notes.md": "Nothing objectionable.\n" },
        },
      },
      { "no-simply": DOCS_ONLY }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.findings.map((finding) => finding.file)).toEqual([
      `${testsPath("no-simply")}/fail/inside/docs/guide/notes.md`,
    ]);
  });

  it("fails a case whose document the scope excluded, and says so", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: {
            "inside/docs/guide/notes.md": "Just simply do it.\n",
            "outside/notes.md": "Just simply do it.\n",
          },
          pass: { "clean/docs/guide/notes.md": "Nothing objectionable.\n" },
        },
      },
      { "no-simply": DOCS_ONLY }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    // The same text, so the only difference between the two cases is where
    // the document sits.
    expect(result.missingFailures).toEqual([
      `${testsPath("no-simply")}/fail/outside/`,
    ]);
    // It fires with the scope removed, so the message blames the scope and
    // names it, rather than sending the author to edit a pattern that works.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("scope excluded every file in it");
    expect(result.errors[0]).toContain(
      `${testsPath("no-simply")}/fail/outside/`
    );
    expect(result.errors[0]).toContain(".vale.ini matchers");
  });
});

withVale("verifyValeRules", () => {
  it("verifies every rule that has fixtures", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply"), "no-very": existence("very") },
      {
        "no-simply": {
          fail: { "a/a.md": "Just simply do it.\n" },
          pass: { "c/c.md": "Nothing objectionable.\n" },
        },
        "no-very": {
          fail: { "a/a.md": "It is very good.\n" },
          pass: { "c/c.md": "Nothing objectionable.\n" },
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
      source: undefined,
      tried: ["@taskless/vale-darwin-arm64", "PATH"],
    });

    // Both buckets, or the rule short-circuits on incomplete fixtures and Vale
    // is never invoked — the binary's absence would go unnoticed.
    const cwd = bothBuckets();
    const outcome = await verifyValeRules(cwd);
    expect(outcome.status).toBe("unavailable");
  });
});

describe("verifyValeRule asks whether Vale read each case", () => {
  const DOCS_ONLY = SCOPED("no-simply", "docs/**/*.md");

  it("fails a pass case whose document the matchers never admit", async () => {
    // Quiet because Vale never read it, not because the text is clean: a pass
    // on no evidence.
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "inside/docs/guide/notes.md": "Just simply do it.\n" },
          pass: { "outside/notes.md": "Nothing objectionable.\n" },
        },
      },
      { "no-simply": DOCS_ONLY }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("pass case was never read");
    expect(result.errors[0]).toContain("scope excluded every file in it");
  });

  it("fails a case whose only document is empty", async () => {
    const cwd = makeProject(
      { "no-simply": existence("simply") },
      {
        "no-simply": {
          fail: { "inside/docs/guide/notes.md": "Just simply do it.\n" },
          pass: { "blank/docs/guide/notes.md": "" },
        },
      },
      { "no-simply": DOCS_ONLY }
    );
    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.errors.join("\n")).toContain("pass case was never read");
    expect(result.errors.join("\n")).not.toContain("scope excluded");
  });
});

describe("verifyValeRule and Vale's notice", () => {
  // The notice is the only thing that distinguishes a run Vale ignored from a
  // run that found nothing: a `W101 … isn't a core option` warning goes to
  // stderr with exit zero and an empty result, so a verification that drops it
  // reports a clean pass for a rule Vale never applied. `runVale` is stubbed
  // because the config verification generates is always well-formed — the
  // diagnostic is real, but no fixture layout can provoke it here.
  const NOTICE =
    "Vale reported while running: W101 'rules.no-simply' isn't a core option; Vale is ignoring it.";

  it("carries the notice onto a verification that otherwise passes", async () => {
    const cwd = bothBuckets();
    const run = await import("../src/rules/vale/run");
    // Each case is its own run with the case as cwd, so the stub fires only
    // for the `fail/` case, and for the probe that asks whether the quiet
    // `pass/` case was read: a finding on every run would fail the pass case.
    vi.spyOn(run, "runVale").mockImplementation((options) =>
      Promise.resolve({
        status: "ok",
        blocking: false,
        results:
          options.cwd.includes(join("tests", "fail")) ||
          String(options.configPath).includes("probe")
            ? [
                {
                  source: "vale",
                  ruleId: "no-simply",
                  severity: "warning",
                  message: "Avoid 'simply'",
                  file: "a.md",
                  range: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 12 },
                  },
                  matchedText: "simply",
                },
              ]
            : [],
        notices: [NOTICE],
      })
    );

    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.passed).toBe(true);
    // Deduplicated across the two case runs.
    expect(result.notices).toEqual([NOTICE]);
  });

  it("leaves the notices empty when Vale said nothing", async () => {
    const cwd = bothBuckets();
    const run = await import("../src/rules/vale/run");
    vi.spyOn(run, "runVale").mockResolvedValue({
      status: "ok",
      blocking: false,
      results: [],
      notices: [],
    });

    const result = verification(await verifyValeRule(cwd, "no-simply"));
    expect(result.notices).toEqual([]);
  });
});
