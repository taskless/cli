import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

import { parse } from "yaml";

import {
  astGrepRuleSchema,
  TASKLESS_REQUIRED_FIELDS,
  findRegexWithoutKind,
} from "../schemas/ast-grep-rule";
import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  resolveSgConfigPath,
  type SgConfigSource,
} from "../filesystem/sgconfig";
import {
  astGrepRuleFileCandidates,
  astGrepRuleTestDirectories,
  ENGINE_LAYOUTS,
  LEGACY_RULES_DIRECTORY,
  LEGACY_RULE_TESTS_DIRECTORY,
} from "./engines";
import { findSgBinary, buildPath } from "./scan";
import astGrepJsonSchema from "../generated/ast-grep-rule-schema.json";
import { RULE_EXAMPLES } from "./verify-examples";
import { isValidRuleId } from "./validate-id";

// --- Helpers ---

/** Escape special regex characters so a string can be used as a literal pattern */
function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

// --- Types ---

export interface LayerResult {
  valid: boolean;
  errors: string[];
}

export interface RequirementsResult extends LayerResult {
  hasTestFile: boolean;
}

export interface TestLayerResult extends LayerResult {
  passed: number;
  failed: number;
}

export interface VerifyResult {
  success: boolean;
  ruleId: string;
  schema: LayerResult;
  requirements: LayerResult;
  tests: TestLayerResult;
}

// --- Schema mode ---

export function getSchemaPayload(): Record<string, unknown> {
  return {
    astGrepSchema: astGrepJsonSchema,
    tasklessRequirements: {
      requiredFields: [...TASKLESS_REQUIRED_FIELDS],
      rules: [
        {
          name: "regex-requires-kind",
          description:
            "Rules using `regex` in any position must also specify `kind` at the same level. Without kind, regex matches against node text which is ambiguous and slow.",
        },
      ],
    },
    examples: RULE_EXAMPLES,
  };
}

// --- Layer 1: Schema validation ---

function validateSchema(ruleData: unknown): LayerResult {
  const result = astGrepRuleSchema.safeParse(ruleData);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  return { valid: false, errors };
}

// --- Layer 2: Taskless requirements ---

async function validateRequirements(
  cwd: string,
  ruleId: string,
  ruleData: Record<string, unknown>
): Promise<RequirementsResult> {
  const errors: string[] = [];

  // Check required fields
  for (const field of TASKLESS_REQUIRED_FIELDS) {
    if (
      !(field in ruleData) ||
      ruleData[field] === undefined ||
      ruleData[field] === null ||
      ruleData[field] === ""
    ) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check regex-requires-kind in rule and other top-level rule containers
  for (const key of ["rule", "constraints", "utils"]) {
    const container = ruleData[key];
    if (
      container &&
      typeof container === "object" &&
      !Array.isArray(container)
    ) {
      if (key === "rule") {
        errors.push(
          ...findRegexWithoutKind(container as Record<string, unknown>)
        );
      } else {
        // constraints/utils are Record<string, RuleObject>
        for (const [name, value] of Object.entries(
          container as Record<string, unknown>
        )) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            errors.push(
              ...findRegexWithoutKind(
                value as Record<string, unknown>,
                `${key}.${name}`
              )
            );
          }
        }
      }
    }
  }

  // Check a test file exists, in either layout the CLI dispatches.
  let hasTestFile = false;
  for (const testDirectory of astGrepRuleTestDirectories(cwd)) {
    try {
      const entries = await readdir(testDirectory);
      if (
        entries.some(
          (f) => f.startsWith(`${ruleId}-`) && f.endsWith("-test.yml")
        )
      ) {
        hasTestFile = true;
        break;
      }
    } catch {
      // directory doesn't exist
    }
  }
  if (!hasTestFile) {
    errors.push(
      `No test file found for rule "${ruleId}" in ` +
        `.taskless/${ENGINE_LAYOUTS.sg.ruleTestsDirectory}/ or ` +
        `.taskless/${LEGACY_RULE_TESTS_DIRECTORY}/`
    );
  }

  return { valid: errors.length === 0, errors, hasTestFile };
}

// --- Layer 3: Test execution ---

async function runTests(
  cwd: string,
  ruleId: string,
  layout: SgConfigSource
): Promise<TestLayerResult> {
  // Point ast-grep at the layout the rule was actually resolved from: the
  // committed `sg/sgconfig.yml` over `sg/rule-tests/`, or a generated config
  // when the rule still lives at the pre-migration path.
  const configPath = await resolveSgConfigPath(cwd, layout);

  const sgBinary = findSgBinary();

  return new Promise((resolve) => {
    const child = spawn(
      sgBinary,
      [
        "test",
        "-c",
        configPath,
        "--skip-snapshot-tests",
        "--filter",
        `^${escapeRegExp(ruleId)}$`,
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: buildPath() },
      }
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on("error", () => {
      resolve({
        valid: false,
        errors: ["ast-grep (sg) binary not found. Is @ast-grep/cli installed?"],
        passed: 0,
        failed: 0,
      });
    });

    child.on("close", (code) => {
      const output = stdoutChunks.join("") + stderrChunks.join("");

      // Parse pass/fail counts from sg test output
      // sg test outputs: "test result: ok. 3 passed; 0 failed;"
      const passedMatch = /(\d+)\s+passed/i.exec(output);
      const failedMatch = /(\d+)\s+failed/i.exec(output);
      const passed = passedMatch ? Number(passedMatch[1]) : 0;
      const failed = failedMatch ? Number(failedMatch[1]) : 0;

      if (code === 0) {
        resolve({ valid: true, errors: [], passed, failed });
      } else {
        const errors: string[] = [];
        if (failed > 0) {
          errors.push(`${String(failed)} test case(s) failed`);
        }
        const stderr = stderrChunks.join("").trim();
        if (stderr && failed === 0) {
          errors.push(stderr);
        }
        if (errors.length === 0) {
          const snippet = output.trim().slice(0, 200);
          errors.push(
            `sg test exited with code ${String(code)}${snippet ? `: ${snippet}` : ""}`
          );
        }
        resolve({ valid: false, errors, passed, failed });
      }
    });
  });
}

// --- Main verify ---

export async function verifyRule(
  cwd: string,
  ruleId: string
): Promise<VerifyResult> {
  if (!isValidRuleId(ruleId)) {
    const errorMessage = `Invalid rule ID "${ruleId}". Rule IDs must be lowercase alphanumeric with hyphens.`;
    return {
      success: false,
      ruleId,
      schema: { valid: false, errors: [errorMessage] },
      requirements: { valid: false, errors: [errorMessage] },
      tests: { valid: false, errors: [errorMessage], passed: 0, failed: 0 },
    };
  }

  // Settle the layout before resolving anything: the migration moves rules
  // between the two candidate paths, so resolving first and migrating later
  // would point ast-grep at a directory the migration has just emptied.
  await ensureTasklessDirectory(cwd);

  // Resolve the rule from the engine directory first, then the legacy path,
  // and remember which layout won so the test run points ast-grep at it.
  const candidates = astGrepRuleFileCandidates(cwd, ruleId);
  let ruleContent: string | undefined;
  let layout: SgConfigSource = {
    rulesDirectory: ENGINE_LAYOUTS.sg.rulesDirectory,
    ruleTestsDirectory: ENGINE_LAYOUTS.sg.ruleTestsDirectory,
    legacy: false,
  };
  for (const [index, candidate] of candidates.entries()) {
    try {
      ruleContent = await readFile(candidate, "utf8");
      if (index > 0) {
        layout = {
          rulesDirectory: LEGACY_RULES_DIRECTORY,
          ruleTestsDirectory: LEGACY_RULE_TESTS_DIRECTORY,
          legacy: true,
        };
      }
      break;
    } catch {
      // Not in this layout — try the next.
    }
  }

  if (ruleContent === undefined) {
    return {
      success: false,
      ruleId,
      schema: {
        valid: false,
        errors: [
          `Rule file not found: .taskless/${ENGINE_LAYOUTS.sg.rulesDirectory}/${ruleId}.yml ` +
            `or .taskless/${LEGACY_RULES_DIRECTORY}/${ruleId}.yml`,
        ],
      },
      requirements: {
        valid: false,
        errors: ["Cannot check requirements: rule file not found"],
      },
      tests: {
        valid: false,
        errors: ["Cannot run tests: rule file not found"],
        passed: 0,
        failed: 0,
      },
    };
  }

  let ruleData: unknown;
  try {
    ruleData = parse(ruleContent);
  } catch (error) {
    const message = `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`;
    return {
      success: false,
      ruleId,
      schema: { valid: false, errors: [message] },
      requirements: {
        valid: false,
        errors: ["Cannot check requirements: invalid YAML"],
      },
      tests: {
        valid: false,
        errors: ["Cannot run tests: invalid YAML"],
        passed: 0,
        failed: 0,
      },
    };
  }

  // Layer 1
  const schemaResult = validateSchema(ruleData);

  // Layer 2
  const requirementsResult = await validateRequirements(
    cwd,
    ruleId,
    (ruleData && typeof ruleData === "object" ? ruleData : {}) as Record<
      string,
      unknown
    >
  );

  // Layer 3 — only if test file exists (Layer 2 checks this)
  const testResult = requirementsResult.hasTestFile
    ? await runTests(cwd, ruleId, layout)
    : {
        valid: false,
        errors: ["Skipped: no test file found"],
        passed: 0,
        failed: 0,
      };

  return {
    success: schemaResult.valid && requirementsResult.valid && testResult.valid,
    ruleId,
    schema: schemaResult,
    requirements: requirementsResult,
    tests: testResult,
  };
}
