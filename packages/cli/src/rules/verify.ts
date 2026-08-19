import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { parse } from "yaml";

import {
  astGrepRuleSchema,
  TASKLESS_REQUIRED_FIELDS,
  findRegexWithoutKind,
} from "../schemas/ast-grep-rule";
import { ensureTasklessDirectory } from "../filesystem/directory";
import { assembleSgConfig } from "./assemble";
import {
  RULE_TESTS_DIRECTORY,
  RULES_DIRECTORY,
  ruleFilePath,
  ruleTestsDirectory,
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

  // A rule's tests live inside the rule directory, so there is one place to
  // look and no resolution order to get wrong.
  let hasTestFile = false;
  try {
    const entries = await readdir(ruleTestsDirectory(cwd, "sg", ruleId));
    hasTestFile = entries.some(
      (f) => f.startsWith(`${ruleId}-`) && f.endsWith("-test.yml")
    );
  } catch {
    // No tests directory — hasTestFile stays false.
  }
  if (!hasTestFile) {
    errors.push(
      `No test file found for rule "${ruleId}" in ` +
        `.taskless/${RULES_DIRECTORY}/sg/${ruleId}/${RULE_TESTS_DIRECTORY}/`
    );
  }

  return { valid: errors.length === 0, errors, hasTestFile };
}

// --- Layer 3: Test execution ---

/**
 * Drop SGR escape sequences.
 *
 * ast-grep colorizes even when stdout is not a TTY, and the escape lands
 * *inside* the phrase we anchor on — `test result: \u001B[32mok\u001B[0m.` — so
 * stripping is a precondition for matching the summary at all, not cosmetics.
 * Pinned by `ast-grep-vendor-contract.test.ts`.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001B\[[\d;]*m/g, "");
}

/**
 * The counts from `ast-grep test`'s summary line, or `undefined` if there is
 * none.
 *
 * `ast-grep test` has no structured output at 0.41.0 — `--help` offers nothing
 * machine-readable — so the counts can only come from prose. What makes that
 * defensible is anchoring: the match is the whole summary line, in one of the
 * two exact forms ast-grep emits, rather than the first number in the stream
 * that happens to be followed by "passed".
 *
 * That distinction is the bug in #112. A *failing* run echoes the offending
 * test's source, so a fixture reading `const msg = '7 passed; 0 failed';` was
 * matched ahead of `Error: test failed. 0 passed; 1 failed;` and the CLI
 * reported 7 passed, 0 failed. Wrong counts, not a false pass — validity comes
 * from the exit code — but those counts are fed back to the agent driving
 * `improve-rule`, so they steer the next edit.
 *
 * The last summary line wins, since only the final one describes the whole run.
 */
function parseTestSummary(
  output: string
): { passed: number; failed: number } | undefined {
  const summary =
    /^(?:test result: ok\.|Error: test failed\.) (\d+) passed; (\d+) failed;/gm;
  let found: { passed: number; failed: number } | undefined;
  for (const match of stripAnsi(output).matchAll(summary)) {
    found = { passed: Number(match[1]), failed: Number(match[2]) };
  }
  return found;
}

async function runTests(cwd: string, ruleId: string): Promise<TestLayerResult> {
  // Assembly names every rule's `.tests/` as its own `testConfigs` entry, so
  // the filter below selects a rule whose tests ast-grep already knows how to
  // find.
  const configPath = await assembleSgConfig(cwd);
  if (configPath === undefined) {
    return {
      valid: false,
      errors: ["No ast-grep rules are present, so no tests could be run."],
      passed: 0,
      failed: 0,
    };
  }

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

    // One decoder per stream, not `chunk.toString()` per chunk. A multi-byte
    // UTF-8 sequence split across a chunk boundary would otherwise have each
    // half independently replaced with U+FFFD, and ast-grep echoes fixture
    // source — arbitrary user text — into the output of a failing run. Same
    // treatment `vale/run.ts` already gives its streams.
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(stdoutDecoder.write(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(stderrDecoder.write(chunk));
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
      // Flush whatever partial multi-byte sequence each decoder is holding, so
      // a stream that ends mid-character contributes its replacement char once
      // rather than leaving bytes unaccounted for.
      stdoutChunks.push(stdoutDecoder.end());
      stderrChunks.push(stderrDecoder.end());

      // Both streams, because ast-grep prints the passing summary to stdout and
      // the failing one to stderr. Joined with a newline so the summary stays
      // at the start of a line for the anchored match.
      const output = `${stdoutChunks.join("")}\n${stderrChunks.join("")}`;

      const summary = parseTestSummary(output);
      const passed = summary?.passed ?? 0;
      const failed = summary?.failed ?? 0;

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

/** Layer 3, or the reason it was not run. Skips are errors, never a pass. */
async function runTestLayer(
  cwd: string,
  ruleId: string,
  requested: boolean,
  hasTestFile: boolean
): Promise<TestLayerResult> {
  if (!requested) {
    return {
      valid: false,
      errors: ["Skipped: tests were not requested"],
      passed: 0,
      failed: 0,
    };
  }
  if (hasTestFile) return runTests(cwd, ruleId);
  return {
    valid: false,
    errors: ["Skipped: no test file found"],
    passed: 0,
    failed: 0,
  };
}

export interface VerifyRuleOptions {
  /**
   * Run Layer 3 — `sg test` over the rule's fixtures. Defaults to `true`.
   *
   * `false` stops after Layers 1–2, for a caller that only needs to know the
   * rule is well-formed. Layer 3 assembles an ast-grep config and spawns a
   * subprocess, so a caller that runs `verifyRule` for its schema verdict and
   * then runs it again for its tests pays that twice per rule.
   *
   * When Layer 3 is skipped, `tests` carries the skip as an error and
   * `success` is therefore `false`. That is deliberate: a result whose tests
   * never ran must not read as a rule that passed.
   */
  runTests?: boolean;
}

export async function verifyRule(
  cwd: string,
  ruleId: string,
  options?: VerifyRuleOptions
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

  // Settle the layout before resolving anything: the migrations move rules, so
  // resolving first and migrating later would read a directory the migration
  // has just emptied.
  await ensureTasklessDirectory(cwd);

  let ruleContent: string | undefined;
  try {
    ruleContent = await readFile(ruleFilePath(cwd, "sg", ruleId), "utf8");
  } catch {
    // Reported below as a missing rule file.
  }

  if (ruleContent === undefined) {
    return {
      success: false,
      ruleId,
      schema: {
        valid: false,
        errors: [
          `Rule file not found: .taskless/${RULES_DIRECTORY}/sg/${ruleId}/${ruleId}.yml`,
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

  // Layer 3 — only when asked for, and only if a test file exists (Layer 2
  // checks this).
  const testResult = await runTestLayer(
    cwd,
    ruleId,
    options?.runTests ?? true,
    requirementsResult.hasTestFile ?? false
  );

  return {
    success: schemaResult.valid && requirementsResult.valid && testResult.valid,
    ruleId,
    schema: schemaResult,
    requirements: requirementsResult,
    tests: testResult,
  };
}
