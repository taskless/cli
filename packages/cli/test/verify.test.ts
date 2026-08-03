import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { stringify } from "yaml";

import { verifyRule, getSchemaPayload } from "../src/rules/verify";

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
