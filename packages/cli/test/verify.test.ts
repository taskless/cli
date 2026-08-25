import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { stringify } from "yaml";

import { verifyRule, getSchemaPayload } from "../src/rules/verify";

/**
 * A rule that fires on `eval(...)`, plus one test file holding exactly the
 * buckets given. Mirrors the Vale coverage cases in `vale-verify.test.ts`,
 * which build the same four shapes out of `pass/` and `fail/` directories.
 */
async function coverageProject(
  cwd: string,
  buckets: { valid?: string[]; invalid?: string[] }
): Promise<void> {
  const rulesDirectory = join(cwd, ".taskless", "sg", "rules");
  const testsDirectory = join(cwd, ".taskless", "sg", "rule-tests");
  await mkdir(rulesDirectory, { recursive: true });
  await mkdir(testsDirectory, { recursive: true });
  await writeFile(
    join(rulesDirectory, "no-eval.yml"),
    stringify({
      id: "no-eval",
      language: "typescript",
      severity: "error",
      message: "Do not use eval()",
      rule: { pattern: "eval($$$)" },
    }),
    "utf8"
  );
  await writeFile(
    join(testsDirectory, "no-eval-20260330-test.yml"),
    stringify({ id: "no-eval", ...buckets }),
    "utf8"
  );
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
    // Write a valid rule
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    const testsDirectory = join(
      temporaryDirectory,
      ".taskless",
      "sg",
      "rule-tests"
    );
    await mkdir(rulesDirectory, { recursive: true });
    await mkdir(testsDirectory, { recursive: true });

    await writeFile(
      join(rulesDirectory, "no-eval.yml"),
      stringify({
        id: "no-eval",
        language: "typescript",
        severity: "error",
        message: "Do not use eval()",
        rule: { pattern: "eval($$$)" },
      }),
      "utf8"
    );

    await writeFile(
      join(testsDirectory, "no-eval-20260330-test.yml"),
      stringify({
        id: "no-eval",
        valid: ["const x = 1;"],
        invalid: ["eval('alert(1)')"],
      }),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.schema.valid).toBe(true);
    expect(result.requirements.valid).toBe(true);
    expect(result.tests.valid).toBe(true);
    expect(result.success).toBe(true);
    expect(result.schema.errors).toHaveLength(0);
    expect(result.requirements.errors).toHaveLength(0);
    expect(result.tests.errors).toHaveLength(0);
    expect(result.tests.passed).toBe(1);
    expect(result.tests.failed).toBe(0);
  });

  it("isolates test results to the specified rule only", async () => {
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    const testsDirectory = join(
      temporaryDirectory,
      ".taskless",
      "sg",
      "rule-tests"
    );
    await mkdir(rulesDirectory, { recursive: true });
    await mkdir(testsDirectory, { recursive: true });

    // Rule A: valid, tests pass
    await writeFile(
      join(rulesDirectory, "no-eval.yml"),
      stringify({
        id: "no-eval",
        language: "typescript",
        severity: "error",
        message: "Do not use eval()",
        rule: { pattern: "eval($$$)" },
      }),
      "utf8"
    );
    await writeFile(
      join(testsDirectory, "no-eval-20260330-test.yml"),
      stringify({
        id: "no-eval",
        valid: ["const x = 1;"],
        invalid: ["eval('alert(1)')"],
      }),
      "utf8"
    );

    // Rule B: valid rule, but test file has a "valid" case that actually triggers
    await writeFile(
      join(rulesDirectory, "no-console.yml"),
      stringify({
        id: "no-console",
        language: "typescript",
        severity: "warning",
        message: "No console",
        rule: { pattern: "console.log($$$)" },
      }),
      "utf8"
    );
    await writeFile(
      join(testsDirectory, "no-console-20260330-test.yml"),
      stringify({
        id: "no-console",
        valid: ["console.log('this should fail')"], // deliberately wrong — triggers the rule
        invalid: ["console.log('correct')"],
      }),
      "utf8"
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
      expect.stringContaining("No test file found")
    );
    expect(result.tests.errors).toContainEqual(
      expect.stringContaining("no test file")
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
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    const testsDirectory = join(
      temporaryDirectory,
      ".taskless",
      "sg",
      "rule-tests"
    );
    await mkdir(rulesDirectory, { recursive: true });
    await mkdir(testsDirectory, { recursive: true });

    await writeFile(
      join(rulesDirectory, "regex-no-kind.yml"),
      stringify({
        id: "regex-no-kind",
        language: "typescript",
        severity: "error",
        message: "Bad regex usage",
        rule: { regex: "foo.*bar" },
      }),
      "utf8"
    );

    await writeFile(
      join(testsDirectory, "regex-no-kind-20260330-test.yml"),
      stringify({
        id: "regex-no-kind",
        valid: ["const x = 1;"],
        invalid: ["foobar"],
      }),
      "utf8"
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

  it("reads the counts off the summary line, not off echoed fixture text", async () => {
    // Regression for #112. `ast-grep test` echoes the source of a FAILING case
    // into its output, and the old parser took the first `(\d+)\s+passed`
    // anywhere in stdout+stderr — so this fixture made a run whose summary says
    // `0 passed; 1 failed;` report 7 passed, 0 failed. Wrong counts rather than
    // a false pass (validity comes from the exit code), but the counts are what
    // `improve-rule` feeds back to an agent iterating on the rule.
    const rulesDirectory = join(temporaryDirectory, ".taskless", "sg", "rules");
    const testsDirectory = join(
      temporaryDirectory,
      ".taskless",
      "sg",
      "rule-tests"
    );
    await mkdir(rulesDirectory, { recursive: true });
    await mkdir(testsDirectory, { recursive: true });

    await writeFile(
      join(rulesDirectory, "no-eval.yml"),
      stringify({
        id: "no-eval",
        language: "typescript",
        severity: "error",
        message: "Do not use eval()",
        rule: { pattern: "eval($$$)" },
      }),
      "utf8"
    );

    // The invalid case contains no `eval(...)`, so the rule does not fire and
    // ast-grep echoes it back as a failure — carrying its numbers with it.
    await writeFile(
      join(testsDirectory, "no-eval-20260330-test.yml"),
      stringify({
        id: "no-eval",
        valid: [],
        invalid: ["const msg = '7 passed; 0 failed';"],
      }),
      "utf8"
    );

    const result = await verifyRule(temporaryDirectory, "no-eval");

    expect(result.tests.valid).toBe(false);
    expect(result.tests.passed).toBe(0);
    expect(result.tests.failed).toBe(1);
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
      expect(result.schema.notice).toContain(
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
      expect(result.schema.notice).toContain('"ts" works');
    });

    it("says nothing at all about the canonical spelling", async () => {
      await ruleWithLanguage(temporaryDirectory, "TypeScript");
      const result = await verifyRule(temporaryDirectory, "no-eval", {
        runTests: false,
      });
      expect(result.schema.valid).toBe(true);
      expect(result.schema.notice).toBeUndefined();
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
      expect(result.schema.notice).toContain("some globs name .tsx");
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
      expect(result.schema.notice).toBeUndefined();
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
      expect(result.schema.notice).toContain("some globs name .tsx");
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
      // Both buckets present and both empty. `ast-grep test` calls this
      // `1 passed; 0 failed` and exits zero, so without the coverage check the
      // rule reports a clean pass having demonstrated nothing at all.
      await coverageProject(temporaryDirectory, { valid: [], invalid: [] });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("none");
      expect(result.tests.valid).toBe(false);
      expect(result.success).toBe(false);
    });

    it("does not report success for a rule with only valid fixtures", async () => {
      // The misleading half, and the shape #152 arrived as: every fixture is
      // a source the rule should stay quiet on, so the run is trivially green
      // and the rule has never been shown to match anything.
      await coverageProject(temporaryDirectory, { valid: ["const x = 1;"] });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("valid-only");
      expect(result.tests.valid).toBe(false);
    });

    it("does not report success for a rule with only invalid fixtures", async () => {
      // The rule is shown to fire and never shown not to over-fire.
      await coverageProject(temporaryDirectory, {
        invalid: ["eval('alert(1)')"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("invalid-only");
      expect(result.tests.valid).toBe(false);
    });

    it("reports both buckets for a rule that populated each", async () => {
      await coverageProject(temporaryDirectory, {
        valid: ["const x = 1;"],
        invalid: ["eval('alert(1)')"],
      });
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("both");
      expect(result.tests.valid).toBe(true);
      expect(result.success).toBe(true);
    });

    it("sums buckets across every test file the rule owns", async () => {
      // Coverage is a property of the rule, not of one file: an author who
      // splits `valid:` and `invalid:` across two dated test files has still
      // made the whole claim.
      await coverageProject(temporaryDirectory, { valid: ["const x = 1;"] });
      await writeFile(
        join(
          temporaryDirectory,
          ".taskless",
          "sg",
          "rule-tests",
          "no-eval-20260331-test.yml"
        ),
        stringify({ id: "no-eval", invalid: ["eval('alert(1)')"] }),
        "utf8"
      );
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("both");
      expect(result.tests.valid).toBe(true);
    });

    it("ignores a file in the rule's directory whose own id is another rule", async () => {
      // The filename says `no-eval`, the `id:` inside says otherwise — the
      // shape a draft copied from another rule arrives in. `sg test --filter
      // ^no-eval$` resolves cases against that `id:`, so these fixtures never
      // run; counting them would report coverage the rule never earned.
      await coverageProject(temporaryDirectory, { valid: ["const x = 1;"] });
      await writeFile(
        join(
          temporaryDirectory,
          ".taskless",
          "sg",
          "rule-tests",
          "no-eval-20260331-test.yml"
        ),
        stringify({
          id: "no-alert-scratch",
          invalid: ["eval('alert(1)')"],
        }),
        "utf8"
      );
      const result = await verifyRule(temporaryDirectory, "no-eval");
      expect(result.tests.fixtures).toBe("valid-only");
      expect(result.tests.valid).toBe(false);
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
