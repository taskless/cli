import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { stringify } from "yaml";

import { findValeBinary } from "../src/rules/vale/binary";
import { verifyRule, getSchemaPayload } from "../src/rules/verify";
import { cliRejectionToResult } from "./support/spawn-cli";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);

/** A rule that fires on `eval(...)`, in the shape every other case reuses. */
const NO_EVAL = {
  id: "no-eval",
  language: "typescript",
  severity: "error",
  message: "Do not use eval()",
  rule: { pattern: "eval($$$)" },
};

/**
 * Write sg rule `rule` at `.taskless/rules/sg/<id>/`, with one case directory
 * per source given, each holding the source as `sample.ts`. Cases are named
 * `<bucket>-<n>`.
 */
async function sgProject(
  cwd: string,
  rule: Record<string, unknown> & { id: string },
  buckets: { pass?: string[]; fail?: string[] } = {}
): Promise<void> {
  const directory = join(cwd, ".taskless", "rules", "sg", rule.id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${rule.id}.yml`), stringify(rule), "utf8");
  for (const bucket of ["pass", "fail"] as const) {
    for (const [index, source] of (buckets[bucket] ?? []).entries()) {
      const caseDirectory = join(
        directory,
        "tests",
        bucket,
        `${bucket}-${index + 1}`
      );
      await mkdir(caseDirectory, { recursive: true });
      await writeFile(join(caseDirectory, "sample.ts"), source, "utf8");
    }
  }
}

/**
 * `no-eval` holding exactly the buckets given. Mirrors the Vale coverage cases
 * in `vale-verify.test.ts`, which build the same four shapes.
 */
async function coverageProject(
  cwd: string,
  buckets: { pass?: string[]; fail?: string[] }
): Promise<void> {
  await sgProject(cwd, NO_EVAL, buckets);
}

/**
 * `no-eval`, with its `language:` swapped and any extra top-level keys merged
 * in. No test file, so Layer 3 is skipped — every case below reads
 * `result.schema`, which Layers 2 and 3 cannot reach.
 */
async function ruleWithLanguage(
  cwd: string,
  language: unknown,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const rulesDirectory = join(cwd, ".taskless", "sg", "rules");
  await mkdir(rulesDirectory, { recursive: true });
  await writeFile(
    join(rulesDirectory, "no-eval.yml"),
    stringify({
      id: "no-eval",
      language,
      severity: "error",
      message: "Do not use eval()",
      rule: { pattern: "eval($$$)" },
      ...extra,
    }),
    "utf8"
  );
}

describe("verifyRule", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-verify-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("passes all layers for a valid rule with tests", async () => {
    await sgProject(temporaryDirectory, NO_EVAL, {
      pass: ["const x = 1;"],
      fail: ["eval('alert(1)')"],
    });

    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.schema.valid).toBe(true);
    expect(result.requirements.valid).toBe(true);
    expect(result.tests.valid).toBe(true);
    expect(result.success).toBe(true);
    expect(result.schema.errors).toHaveLength(0);
    expect(result.requirements.errors).toHaveLength(0);
    expect(result.tests.errors).toHaveLength(0);
    // One per case directory: the `pass/` case and the `fail/` case.
    expect(result.tests.passed).toBe(2);
    expect(result.tests.failed).toBe(0);
  });

  it("isolates test results to the specified rule only", async () => {
    // Rule A: valid, tests pass
    await sgProject(temporaryDirectory, NO_EVAL, {
      pass: ["const x = 1;"],
      fail: ["eval('alert(1)')"],
    });

    // Rule B: valid rule, but its "pass" case actually triggers it
    await sgProject(
      temporaryDirectory,
      {
        id: "no-console",
        language: "typescript",
        severity: "warning",
        message: "No console",
        rule: { pattern: "console.log($$$)" },
      },
      {
        pass: ["console.log('this should fail')"], // deliberately wrong — triggers the rule
        fail: ["console.log('correct')"],
      }
    );

    // Verify rule A — should pass despite rule B's test failure
    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.success).toBe(true);
    expect(result.tests.valid).toBe(true);
    expect(result.tests.failed).toBe(0);

    // Verify rule B — should fail
    const resultB = await verifyRule(temporaryDirectory, "no-console");

    expect(resultB.tests.valid).toBe(false);
    expect(resultB.tests.failed).toBeGreaterThan(0);
  });

  it("reports schema errors for invalid rule structure", async () => {
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    await mkdir(rulesDirectory, { recursive: true });

    // Rule with missing required 'rule' field (required by ast-grep schema)
    await writeFile(
      join(rulesDirectory, "bad-rule.yml"),
      stringify({
        id: "bad-rule",
        language: "typescript",
        severity: "error",
        message: "Bad rule",
        // missing 'rule' field
      }),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "bad-rule");

    expect(result.schema.valid).toBe(false);
    expect(result.schema.errors.length).toBeGreaterThan(0);
  });

  it("reports missing test file", async () => {
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    await mkdir(rulesDirectory, { recursive: true });

    await writeFile(
      join(rulesDirectory, "orphan.yml"),
      stringify({
        id: "orphan",
        language: "typescript",
        severity: "warning",
        message: "Orphan rule",
        rule: { pattern: "foo()" },
      }),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "orphan");

    expect(result.requirements.valid).toBe(false);
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("No fixture cases found")
    );
    expect(result.tests.errors).toContainEqual(
      expect.stringContaining("no fixture cases")
    );
  });

  it("reports error for nonexistent rule", async () => {
    const result = await verifyRule(temporaryDirectory, "nonexistent");

    expect(result.success).toBe(false);
    expect(result.schema.valid).toBe(false);
    expect(result.schema.errors).toContainEqual(
      expect.stringContaining("Rule file not found")
    );
  });

  it("rejects rule IDs with path traversal characters", async () => {
    const traversalIds = [
      "../../etc/passwd",
      "../secret",
      "rule/nested",
      "rule.with.dots",
      "UPPERCASE",
      "has spaces",
    ];

    for (const id of traversalIds) {
      const result = await verifyRule(temporaryDirectory, id);
      expect(result.success).toBe(false);
      expect(result.schema.errors).toContainEqual(
        expect.stringContaining("Invalid rule ID")
      );
    }
  });

  it("accepts valid kebab-case rule IDs", async () => {
    // These should fail with "not found", NOT "invalid rule ID"
    const validIds = ["no-eval", "my-rule-123", "a"];

    for (const id of validIds) {
      const result = await verifyRule(temporaryDirectory, id);
      expect(result.schema.errors).not.toContainEqual(
        expect.stringContaining("Invalid rule ID")
      );
    }
  });

  it("reports error for invalid YAML in rule file", async () => {
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    await mkdir(rulesDirectory, { recursive: true });

    await writeFile(
      join(rulesDirectory, "bad-yaml.yml"),
      "id: bad-yaml\nlanguage: typescript\nrule:\n  - invalid: [\n    unclosed bracket",
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "bad-yaml");

    expect(result.success).toBe(false);
    expect(result.schema.valid).toBe(false);
    expect(result.schema.errors).toContainEqual(
      expect.stringContaining("Invalid YAML")
    );
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("invalid YAML")
    );
    expect(result.tests.errors).toContainEqual(
      expect.stringContaining("invalid YAML")
    );
  });

  it("reports regex-without-kind violation", async () => {
    await sgProject(
      temporaryDirectory,
      {
        id: "regex-no-kind",
        language: "typescript",
        severity: "error",
        message: "Bad regex usage",
        rule: { regex: "foo.*bar" },
      },
      { pass: ["const x = 1;"], fail: ["foobar"] }
    );

    const result = await verifyRule(temporaryDirectory, "regex-no-kind");

    expect(result.requirements.valid).toBe(false);
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("regex")
    );
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("kind")
    );
  });

  it("reports missing required Taskless fields", async () => {
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    await mkdir(rulesDirectory, { recursive: true });

    // Rule missing severity and message (Taskless requires them)
    await writeFile(
      join(rulesDirectory, "minimal.yml"),
      stringify({
        id: "minimal",
        language: "typescript",
        rule: { pattern: "foo()" },
      }),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "minimal");

    expect(result.requirements.valid).toBe(false);
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("severity")
    );
    expect(result.requirements.errors).toContainEqual(
      expect.stringContaining("message")
    );
  });

  it("counts cases, one per directory, however many files each holds", async () => {
    // The counts are what `improve-rule` feeds back to an agent iterating on
    // the rule, so they are the CLI's own tally of case directories. A case
    // holding two files is one case, and a quiet `fail/` case is one failure.
    await sgProject(temporaryDirectory, NO_EVAL, {
      pass: ["const x = 1;"],
      fail: ["eval('alert(1)')", "const msg = '7 passed; 0 failed';"],
    });
    await writeFile(
      join(
        temporaryDirectory,
        ".taskless",
        "rules",
        "sg",
        "no-eval",
        "tests",
        "fail",
        "fail-1",
        "second.ts"
      ),
      "eval(y);\n",
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.tests.valid).toBe(false);
    expect(result.tests.passed).toBe(2);
    expect(result.tests.failed).toBe(1);
    expect(result.tests.errors).toEqual([
      expect.stringContaining("tests/fail/fail-2/"),
    ]);
  });

  /**
   * The `language:` field — taskless/cli#165.
   *
   * Layer 1's zod pass cannot answer any of these: the vendored JSON Schema
   * types `language` as a bare string. What ast-grep does with each spelling is
   * pinned separately, against the binary, in
   * `test/ast-grep-vendor-contract.test.ts`.
   */
  describe("the language field", () => {
    it("fails a rule whose language ast-grep does not recognize", async () => {
      // The loud failure, and the reason it is an error rather than a notice:
      // ast-grep cannot deserialize the name, so it abandons the whole config
      // and every other sg rule in the project goes unreported with it.
      await ruleWithLanguage(temporaryDirectory, "nonsense");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(false);
      expect(result.schema.errors.join("\n")).toContain(
        'language: "nonsense" is not a language ast-grep'
      );
    });

    it("names the accepted spellings in the error", async () => {
      // An author who reached for `C#` needs to be told the word `CSharp`, not
      // merely that they were wrong. The full list is printed too, so a
      // spelling the suggestion cannot fold still lands somewhere useful.
      await ruleWithLanguage(temporaryDirectory, "C#");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      const errors = result.schema.errors.join("\n");
      expect(errors).toContain('Did you mean "CSharp"?');
      expect(errors).toContain("Accepted spellings: Bash, C, Cpp");
    });

    it("accepts a case variant and says how ast-grep spells it", async () => {
      // The deliberate non-breaking half. ast-grep resolves `typescript`
      // itself — it is the very spelling its own JSON Schema shows as the
      // field's `example` — so rules already written this way keep working and
      // hear about the canonical name instead of failing.
      await ruleWithLanguage(temporaryDirectory, "typescript");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      // One element, asserted as the whole list: a producer that appended a
      // second advisory into the same string would fail here.
      expect(result.schema.notices).toHaveLength(1);
      expect(result.schema.notices[0]).toContain(
        "TypeScript is how ast-grep spells it"
      );
    });

    it("accepts an extension alias ast-grep resolves", async () => {
      // `ts` is not on the canonical list and is not a case variant of
      // anything on it, but ast-grep accepts it. Rejecting it would fail a
      // rule that demonstrably works — the opposite of the bug being fixed.
      await ruleWithLanguage(temporaryDirectory, "ts");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notices).toHaveLength(1);
      expect(result.schema.notices[0]).toContain('"ts" works');
    });

    it("says nothing at all about the canonical spelling", async () => {
      await ruleWithLanguage(temporaryDirectory, "TypeScript");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notices).toEqual([]);
    });

    it("fails a TypeScript rule scoped only to .tsx files", async () => {
      // The quiet failure. `Tsx` and `TypeScript` are separate parsers, so
      // this rule matches nothing, exits zero, and reads as a clean codebase —
      // the state that is indistinguishable from success at check time.
      await ruleWithLanguage(temporaryDirectory, "TypeScript", {
        files: ["src/**/*.tsx"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(false);
      expect(result.schema.errors.join("\n")).toContain(
        "every glob names .tsx, but language is TypeScript"
      );
    });

    it("only notices when some globs do reach the declared language", async () => {
      // Half the scope is dead, half works. Failing here would fail a rule
      // that reports real findings, so this is worth saying and not worth
      // failing — and brace alternation is one glob naming two extensions.
      await ruleWithLanguage(temporaryDirectory, "TypeScript", {
        files: ["src/**/*.{ts,tsx}"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notices).toHaveLength(1);
      expect(result.schema.notices[0]).toContain("some globs name .tsx");
    });

    it("says nothing about globs that name no extension", async () => {
      // `src/**` states nothing about extensions, so there is nothing to
      // conclude. A check that guessed here would fire on correct rules.
      await ruleWithLanguage(temporaryDirectory, "TypeScript", {
        files: ["src/**"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notices).toEqual([]);
    });

    it("catches the mirror image: Tsx scoped only to .ts", async () => {
      await ruleWithLanguage(temporaryDirectory, "Tsx", {
        files: ["src/**/*.ts"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(false);
      expect(result.schema.errors.join("\n")).toContain(
        "every glob names .ts, but language is Tsx"
      );
    });

    it("reads the object form of a files: entry", async () => {
      // `RuleFileGlob` is a string OR `{ glob, caseInsensitive? }`, and
      // assemble.ts passes `files:` to ast-grep untouched, so both shapes run.
      // Reading only the string form makes the object form scan nothing, which
      // looks identical to a rule whose globs name no extension: no error, no
      // notice, and the wrong-parser trap goes unreported.
      await ruleWithLanguage(temporaryDirectory, "TypeScript", {
        files: [{ glob: "src/**/*.tsx" }],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(false);
      expect(result.schema.errors.join("\n")).toContain(
        "every glob names .tsx, but language is TypeScript"
      );
    });

    it("mixes the two files: shapes in one rule", async () => {
      // Nothing requires an author to pick one form, and `caseInsensitive`
      // is the reason to reach for the object one. Half the scope is dead, so
      // this is the notice case, exactly as it is for two plain strings.
      await ruleWithLanguage(temporaryDirectory, "TypeScript", {
        files: ["src/**/*.ts", { glob: "src/**/*.TSX", caseInsensitive: true }],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notices).toHaveLength(1);
      expect(result.schema.notices[0]).toContain("some globs name .tsx");
    });

    it("leaves a missing language to the required-fields layer", async () => {
      // Reported once, in the layer that owns it. Two messages for one
      // omission only makes the useful one harder to find.
      const rulesDirectory = join(
        temporaryDirectory,
        ".taskless",
        "sg",
        "rules"
      );
      await mkdir(rulesDirectory, { recursive: true });
      await writeFile(
        join(rulesDirectory, "no-eval.yml"),
        stringify({
          id: "no-eval",
          severity: "error",
          message: "Do not use eval()",
          rule: { pattern: "eval($$$)" },
        }),
        "utf8"
      );
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.errors.join("\n")).not.toContain("Accepted");
      expect(result.requirements.errors).toContain(
        "Missing required field: language"
      );
    });
  });

  describe("fixture coverage", () => {
    it("does not report success for a rule with no fixtures", async () => {
      // Both bucket directories present and both empty. Coverage is counted
      // over case directories, so an empty bucket demonstrates nothing.
      await coverageProject(temporaryDirectory, {});
      const testsDirectory = join(
        temporaryDirectory,
        ".taskless",
        "rules",
        "sg",
        "no-eval",
        "tests"
      );
      await mkdir(join(testsDirectory, "pass"), { recursive: true });
      await mkdir(join(testsDirectory, "fail"), { recursive: true });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("none");
      expect(result.tests.valid).toBe(false);
      expect(result.success).toBe(false);
    });

    it("does not report success for a rule with only pass fixtures", async () => {
      // The misleading half, and the shape #152 arrived as: every fixture is
      // a source the rule should stay quiet on, so the run is trivially green
      // and the rule has never been shown to match anything.
      await coverageProject(temporaryDirectory, { pass: ["const x = 1;"] });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("pass-only");
      expect(result.tests.valid).toBe(false);
    });

    it("does not report success for a rule with only fail fixtures", async () => {
      // The rule is shown to fire and never shown not to over-fire.
      await coverageProject(temporaryDirectory, {
        fail: ["eval('alert(1)')"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("fail-only");
      expect(result.tests.valid).toBe(false);
    });

    it("reports both buckets for a rule that populated each", async () => {
      await coverageProject(temporaryDirectory, {
        pass: ["const x = 1;"],
        fail: ["eval('alert(1)')"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("both");
      expect(result.tests.valid).toBe(true);
      expect(result.success).toBe(true);
    });
  });
});

describe("getSchemaPayload", () => {
  it("contains expected top-level keys", () => {
    const payload = getSchemaPayload();
    expect(payload).toHaveProperty("astGrepSchema");
    expect(payload).toHaveProperty("tasklessRequirements");
    expect(payload).toHaveProperty("examples");
  });

  it("includes required fields in tasklessRequirements", () => {
    const payload = getSchemaPayload();
    const requirements = payload.tasklessRequirements as {
      requiredFields: string[];
    };
    expect(requirements.requiredFields).toContain("id");
    expect(requirements.requiredFields).toContain("language");
    expect(requirements.requiredFields).toContain("severity");
    expect(requirements.requiredFields).toContain("message");
    expect(requirements.requiredFields).toContain("rule");
  });

  it("includes curated examples", () => {
    const payload = getSchemaPayload();
    const examples = payload.examples as Array<{
      description: string;
      rule: unknown;
    }>;
    expect(examples.length).toBeGreaterThanOrEqual(3);
    // Check for the three example types
    expect(
      examples.some((example) => example.description.includes("Simple pattern"))
    ).toBe(true);
    expect(
      examples.some((example) => example.description.includes("Regex"))
    ).toBe(true);
    expect(
      examples.some((example) => example.description.includes("Composite"))
    ).toBe(true);
  });
});

/**
 * `packages/cli/src/commands/verify.ts`'s `tested`/`failed`/`refused` split —
 * taskless/cli#284.
 *
 * `tested = results.length - refused.length`, and both the human summary and
 * the `--json` `ok` field are derived from `failed`, which itself excludes
 * anything `isRefused`. Every other test in this repo runs a single rule per
 * invocation, which cannot exercise either arithmetic operation: with one
 * rule, `results.length - refused.length` and `results.length` agree, and a
 * refused rule "leaking" into `failed` is invisible unless something else in
 * the run is a genuine, non-refused failure to compare it against.
 *
 * These run `taskless verify` (not `validate`) because `refused` is only ever set
 * by `verifyOneRule` on a runtime rule denied `--dangerously-run-scripts` — see
 * `packages/cli/src/rules/inspect.ts`. `validate` never produces a refusal, so
 * it cannot exercise this split at all.
 */
const verifyMixedRunBinPath = builtCli();

async function runVerifyMixedRunCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [
      verifyMixedRunBinPath,
      ...args,
    ]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [verifyMixedRunBinPath, ...args]);
  }
}

describe("verify: the verified/failed/refused split on a mixed run (#284)", () => {
  let cwd: string;

  /** An sg rule whose own fixtures either all pass or one deliberately fails. */
  async function sgRule(
    id: string,
    options: { passes: boolean }
  ): Promise<void> {
    // A `pass/` case that actually fires the rule is what makes `taskless
    // verify` report this rule as failed rather than refused or passed.
    await sgProject(
      cwd,
      {
        id,
        language: "TypeScript",
        severity: "error",
        message: `no ${id}`,
        rule: { pattern: "console.log($ARG)" },
      },
      {
        pass: [
          options.passes ? "const a = 1;" : "console.log('this should fail');",
        ],
        fail: ["console.log('correct');"],
      }
    );
  }

  /**
   * A runtime rule that validates cleanly but whose fixtures are always
   * REFUSED, because nothing here ever passes `--dangerously-run-scripts`.
   * Shape mirrors `runtime-check.test.ts`'s `RUNTIME_CAPTURE`/`RUNTIME_CHECK`.
   */
  async function refusedRuntimeRule(id: string): Promise<void> {
    const directory = join(cwd, ".taskless", "rules", "runtime", id);
    await mkdir(join(directory, "captures"), { recursive: true });
    await writeFile(
      join(directory, "captures", "logs.yml"),
      stringify({
        id: "logs-abc12345",
        language: "typescript",
        rule: { pattern: "console.log($A)" },
        metadata: {
          taskless: {
            version: 1,
            kind: "runtime",
            name: "logs",
            check: "check.ts",
            match: "anchor",
          },
        },
      })
    );
    await writeFile(
      join(directory, "check.ts"),
      "export default async function (root, matches) {\n" +
        '  return matches.map((m) => ({ file: m.file, line: m.line, message: "runtime " + m.rule, severity: "warning" }));\n' +
        "}\n"
    );
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-verify-mixed-"));
    await runVerifyMixedRunCli(["init", "-d", cwd]);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("keeps tested, failed, and refused as three independent counts", async () => {
    // One rule of each outcome: a pass, a genuine failure, and a refusal.
    // `results.length` is 3; `tested` must be 2 (3 minus the 1 refused); and
    // `failed` must be 1 (the genuine failure only, not the refusal too).
    // With all three numbers different, no pair of them can be swapped for
    // another and still match what this test asserts.
    await sgRule("pass-rule", { passes: true });
    await sgRule("fail-rule", { passes: false });
    await refusedRuntimeRule("rt-rule");

    const jsonResult = await runVerifyMixedRunCli([
      "verify",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(jsonResult.stdout) as {
      ok: boolean;
      rules: {
        engine: string;
        ruleId: string;
        ok: boolean;
        refused?: string;
      }[];
    };
    // The `ok` field is derived from `failed`, and must stay false because of
    // the one genuine failure — a mutation that let the refusal leak into
    // `failed` would not be visible here (it is already false), which is why
    // the second test below isolates that case with no genuine failure.
    expect(report.ok).toBe(false);
    expect(jsonResult.exitCode).not.toBe(0);
    expect(report.rules.find((rule) => rule.ruleId === "pass-rule")?.ok).toBe(
      true
    );
    expect(report.rules.find((rule) => rule.ruleId === "fail-rule")?.ok).toBe(
      false
    );
    const runtimeRule = report.rules.find((rule) => rule.ruleId === "rt-rule");
    expect(runtimeRule?.refused).toBeDefined();

    // The human summary is the only place `tested` is rendered at all — it is
    // not in the `--json` envelope — so this is the only way to pin its value.
    const humanResult = await runVerifyMixedRunCli(["verify", "-d", cwd]);
    expect(humanResult.exitCode).not.toBe(0);
    expect(humanResult.stdout).toContain("1 of 2 rule(s) failed.");
    expect(humanResult.stdout).toContain("1 rule(s) did not run.");
  });

  it("does not let a refused rule count as a failure", async () => {
    // No genuine failure at all: one passing rule and one refused rule. If a
    // refused rule were counted in `failed`, `ok` would read false and the
    // human summary would read "of 1 rule(s) failed" instead of "tested".
    await sgRule("pass-rule", { passes: true });
    await refusedRuntimeRule("rt-rule");

    const jsonResult = await runVerifyMixedRunCli([
      "verify",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(jsonResult.stdout) as { ok: boolean };
    expect(report.ok).toBe(true);
    expect(jsonResult.exitCode).toBe(0);

    const humanResult = await runVerifyMixedRunCli(["verify", "-d", cwd]);
    expect(humanResult.exitCode).toBe(0);
    expect(humanResult.stdout).toContain("1 rule(s) verified.");
    expect(humanResult.stdout).toContain("1 rule(s) did not run.");
    expect(humanResult.stdout).not.toContain("failed");
  });
});

/**
 * The findings `verify` reports, per rule and per fixture bucket, for the Vale
 * and runtime engines. The ast-grep half lives in `sg-fixtures.test.ts`.
 *
 * The defect these exist for: `verify --json` reported a boolean per rule and
 * nothing else, while the findings that produced the boolean were in hand and
 * thrown away. A rule whose message interpolates its captures can have the
 * slots in the wrong order, fire on every `fail/` case, stay quiet on every
 * `pass/` one, and be reported as a rule that passed. The RENDERED message is
 * the only evidence otherwise, so the assertions on it below must not be
 * relaxed to "some message".
 *
 * These spawn the built CLI, because the always-present `findings` key and the
 * human rendering are both properties of what the command prints.
 */
interface ReportedFinding {
  source: string;
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  matchedText: string;
  bucket: "pass" | "fail";
}

interface FindingsReport {
  ok: boolean;
  rules: {
    engine: string;
    ruleId: string;
    ok: boolean;
    errors: string[];
    ran?: boolean;
    refused?: string;
    findings: ReportedFinding[];
  }[];
}

function findingsOf(
  report: FindingsReport,
  bucket?: "pass" | "fail"
): ReportedFinding[] {
  const findings = report.rules.flatMap((rule) => rule.findings);
  return bucket === undefined
    ? findings
    : findings.filter((finding) => finding.bucket === bucket);
}

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

/** Write one case directory holding a single file. */
async function fixtureCase(
  ruleDirectory: string,
  bucket: "pass" | "fail",
  name: string,
  file: string,
  contents: string
): Promise<void> {
  const caseDirectory = join(ruleDirectory, "tests", bucket, name);
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(join(caseDirectory, file), contents);
}

describe("verify reports the findings each fixture case produced", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-findings-"));
    await runVerifyMixedRunCli(["init", "-d", cwd]);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------------------ */
  /* Vale                                                                      */
  /* ------------------------------------------------------------------------ */

  const VALE_RULE = "use-email";

  /**
   * A `substitution` rule, chosen deliberately over `existence`: its message
   * takes TWO `%s` slots, the replacement and then the match, so it is the
   * check whose message can be wrong in the way a verdict cannot see.
   */
  const SUBSTITUTION_STYLE = [
    "extends: substitution",
    `message: "Use '%s' instead of '%s'"`,
    "level: warning",
    "ignorecase: true",
    "swap:",
    "  e-mail: email",
    "",
  ].join("\n");

  const VALE_CONFIG = [
    "[*.md]",
    `tskl) rule = ${VALE_RULE}`,
    `${VALE_RULE}.${VALE_RULE} = YES`,
    "",
  ].join("\n");

  /** The message Vale renders, with the slots in the order Vale fills them. */
  const RENDERED = "Use 'email' instead of 'e-mail'";

  async function writeValeRule(options: { passFires?: boolean } = {}) {
    const directory = join(cwd, ".taskless", "rules", "vale", VALE_RULE);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${VALE_RULE}.yml`), SUBSTITUTION_STYLE);
    await writeFile(join(directory, ".vale.ini"), VALE_CONFIG);
    await fixtureCase(
      directory,
      "fail",
      "hyphenated",
      "bad.md",
      "Send an e-mail today.\n"
    );
    await fixtureCase(
      directory,
      "pass",
      "plain",
      "ok.md",
      (options.passFires ?? false)
        ? "Send an e-mail now.\n"
        : "Send an email today.\n"
    );
  }

  async function testVale(...extra: string[]) {
    return runVerifyMixedRunCli([
      "verify",
      `.taskless/rules/vale/${VALE_RULE}`,
      "-d",
      cwd,
      ...extra,
    ]);
  }

  withVale("for a Vale rule", () => {
    it("reports the rendered message, so a swapped %s pair cannot pass", async () => {
      await writeValeRule();

      const { stdout, exitCode } = await testVale("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      const messages = findingsOf(report).map((finding) => finding.message);
      expect(messages).toEqual([RENDERED]);
      expect(messages).not.toContain("Use 'e-mail' instead of 'email'");
    });

    it("carries the whole check finding, naming the fixture file", async () => {
      await writeValeRule();

      const { stdout } = await testVale("--json");
      const report = JSON.parse(stdout) as FindingsReport;
      const finding = findingsOf(report)[0];

      expect(finding).toBeDefined();
      expect(finding?.source).toBe("vale");
      expect(finding?.ruleId).toBe(VALE_RULE);
      expect(finding?.severity).toBe("warning");
      expect(finding?.matchedText).toBe("e-mail");
      expect(finding?.file).toBe(
        `.taskless/rules/vale/${VALE_RULE}/tests/fail/hyphenated/bad.md`
      );
      expect(finding?.range.start.line).toBe(0);
      expect(finding?.range.start.column).toBe(8);
    });

    it("reports the fail bucket on a run that passed", async () => {
      // The evidence is only ever produced by a green run. A payload that
      // carried it once the rule was already failing would carry it at the one
      // moment nobody needs it.
      await writeValeRule();

      const { stdout } = await testVale("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(report.rules[0]?.ok).toBe(true);
      expect(findingsOf(report, "fail")).toHaveLength(1);
      expect(findingsOf(report, "pass")).toHaveLength(0);
    });

    it("tags a wrongly-fired pass case as the pass bucket", async () => {
      await writeValeRule({ passFires: true });

      const { stdout, exitCode } = await testVale("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(exitCode).toBe(1);
      expect(report.ok).toBe(false);
      const passFindings = findingsOf(report, "pass");
      expect(passFindings).toHaveLength(1);
      expect(passFindings[0]?.file).toContain("tests/pass/plain/ok.md");
      expect(passFindings[0]?.message).toBe(RENDERED);
    });

    it("prints one line and no findings when the rule passed", async () => {
      await writeValeRule();

      const { stdout } = await testVale();

      expect(stdout).toContain(`✓ vale/${VALE_RULE}`);
      expect(stdout).not.toContain(RENDERED);
      expect(stdout).not.toContain("fixture findings");
    });

    it("prints what matched under a failing rule, not only which case", async () => {
      await writeValeRule({ passFires: true });

      const { stdout } = await testVale();

      expect(stdout).toContain(`✗ vale/${VALE_RULE}`);
      expect(stdout).toContain("pass case wrongly fired:");
      expect(stdout).toContain("pass fixture findings:");
      // `check`'s own renderer, so a finding does not read two ways depending
      // on which command surfaced it.
      expect(stdout).toContain(`warning[${VALE_RULE}] ${RENDERED}`);
      expect(stdout).toContain("> e-mail");
    });

    it("carries an empty array when validation failed before fixtures ran", async () => {
      // No `.vale.ini`, so `validate` fails and `verify` never reaches the
      // fixtures.
      const directory = join(cwd, ".taskless", "rules", "vale", VALE_RULE);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${VALE_RULE}.yml`), SUBSTITUTION_STYLE);

      const { stdout, exitCode } = await testVale("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(exitCode).toBe(1);
      expect(report.rules[0]?.ok).toBe(false);
      expect(report.rules[0]?.ran).toBe(false);
      expect(report.rules[0]?.findings).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Runtime                                                                   */
  /* ------------------------------------------------------------------------ */

  const RUNTIME_RULE = "no-eval";

  const EVAL_CAPTURE = [
    "id: no-eval-abc12345",
    "language: typescript",
    "rule:",
    "  pattern: eval($ARG)",
    "metadata:",
    "  taskless:",
    "    version: 1",
    "    kind: runtime",
    "    name: no-eval",
    "    check: check.ts",
    "    match: anchor",
    "",
  ].join("\n");

  const RUNTIME_MESSAGE = "eval on a non-literal is not allowed";

  /** Reports only where the argument is not a literal, so a pass case can run. */
  const FLAGS_DYNAMIC_EVAL = String.raw`import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function (root, matches) {
  return matches
    .filter((m) => !readFileSync(join(root, m.file), "utf8").includes('eval("'))
    .map((m) => ({
      file: m.file,
      line: m.line,
      column: m.column,
      message: "${RUNTIME_MESSAGE}",
      severity: "warning",
    }));
}
`;

  /** Reports every match, so the `pass/` case wrongly fires. */
  const FLAGS_EVERY_MATCH = `export default async function (root, matches) {
  return matches.map((m) => ({
    file: m.file,
    line: m.line,
    column: m.column,
    message: "${RUNTIME_MESSAGE}",
    severity: "warning",
  }));
}
`;

  async function writeRuntimeRule(check: string = FLAGS_DYNAMIC_EVAL) {
    const directory = join(cwd, ".taskless", "rules", "runtime", RUNTIME_RULE);
    await mkdir(join(directory, "captures"), { recursive: true });
    await writeFile(join(directory, "captures", "eval.yml"), EVAL_CAPTURE);
    await writeFile(join(directory, "check.ts"), check);
    await fixtureCase(
      directory,
      "fail",
      "dynamic-eval",
      "sample.ts",
      "const input = globalThis.userInput;\neval(input);\n"
    );
    await fixtureCase(
      directory,
      "pass",
      "literal-eval",
      "sample.ts",
      'eval("1 + 1");\n'
    );
  }

  async function testRuntime(...extra: string[]) {
    return runVerifyMixedRunCli([
      "verify",
      `.taskless/rules/runtime/${RUNTIME_RULE}`,
      "-d",
      cwd,
      "--dangerously-run-scripts",
      ...extra,
    ]);
  }

  describe("for a runtime rule", () => {
    it("reports what the check said, bucketed by case, on a passing run", async () => {
      await writeRuntimeRule();

      const { stdout, exitCode } = await testRuntime("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(exitCode).toBe(0);
      expect(report.rules[0]?.ok).toBe(true);
      const failFindings = findingsOf(report, "fail");
      expect(failFindings).toHaveLength(1);
      expect(failFindings[0]?.message).toBe(RUNTIME_MESSAGE);
      expect(failFindings[0]?.severity).toBe("warning");
      expect(failFindings[0]?.file).toContain("sample.ts");
      expect(findingsOf(report, "pass")).toHaveLength(0);
    });

    it("tags a wrongly-fired pass case as the pass bucket", async () => {
      await writeRuntimeRule(FLAGS_EVERY_MATCH);

      const { stdout, exitCode } = await testRuntime("--json");
      const report = JSON.parse(stdout) as FindingsReport;

      expect(exitCode).toBe(1);
      expect(findingsOf(report, "pass")).toHaveLength(1);
      expect(findingsOf(report, "fail")).toHaveLength(1);
    });

    it("prints the pass-bucket finding under a failing rule", async () => {
      await writeRuntimeRule(FLAGS_EVERY_MATCH);

      const { stdout } = await testRuntime();

      expect(stdout).toContain(`✗ runtime/${RUNTIME_RULE}`);
      expect(stdout).toContain("pass fixture findings:");
      expect(stdout).toContain(RUNTIME_MESSAGE);
    });

    it("prints one line and no findings when the rule passed", async () => {
      await writeRuntimeRule();

      const { stdout } = await testRuntime();

      expect(stdout).toContain(`✓ runtime/${RUNTIME_RULE}`);
      expect(stdout).not.toContain("fixture findings");
    });

    it("carries an empty array, not an absent key, on a refused run", async () => {
      // Without the flag nothing executes, so there is nothing to report, and
      // that is the case a consumer must not have to tell apart from "this
      // command does not report findings".
      await writeRuntimeRule();

      const { stdout } = await runVerifyMixedRunCli([
        "verify",
        `.taskless/rules/runtime/${RUNTIME_RULE}`,
        "-d",
        cwd,
        "--json",
      ]);
      const report = JSON.parse(stdout) as FindingsReport;

      expect(report.rules[0]?.refused).toBeDefined();
      expect(report.rules[0]?.findings).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* ast-grep: always present                                                  */
  /* ------------------------------------------------------------------------ */

  /** `no-eval-sg`, with one clean `pass/` case and `failSource` as its `fail/` case. */
  async function noEvalSg(failSource: string): Promise<void> {
    await sgProject(
      cwd,
      {
        id: "no-eval-sg",
        language: "TypeScript",
        severity: "error",
        message: "no eval",
        rule: { pattern: "eval($ARG)" },
      },
      { pass: ["const a = 1;"], fail: [failSource] }
    );
  }

  describe("for an ast-grep rule", () => {
    it("carries an empty array, not an absent key, for a rule that matched nothing", async () => {
      // A `fail/` case the rule does not match fails the rule, and the rule
      // produced nothing. Empty is the true answer, and it has to be stated
      // rather than left to an absent key.
      await noEvalSg("const b = 2;");

      const { stdout } = await runVerifyMixedRunCli([
        "verify",
        ".taskless/rules/sg/no-eval-sg",
        "-d",
        cwd,
        "--json",
      ]);
      const report = JSON.parse(stdout) as FindingsReport;

      expect(report.rules[0]?.ok).toBe(false);
      expect(report.rules[0]?.findings).toEqual([]);
    });

    it("carries an empty array for validate, which runs no fixtures", async () => {
      await noEvalSg("eval(x);");

      const { stdout } = await runVerifyMixedRunCli([
        "validate",
        ".taskless/rules/sg/no-eval-sg",
        "-d",
        cwd,
        "--json",
      ]);
      const report = JSON.parse(stdout) as FindingsReport;

      expect(report.rules[0]?.findings).toEqual([]);
    });
  });
});
