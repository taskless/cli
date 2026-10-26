import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import {
  astGrepRuleSchema,
  TASKLESS_REQUIRED_FIELDS,
  findRegexWithoutKind,
} from "../schemas/ast-grep-rule";
import { pathPrefixed, schemaLayer } from "../schemas/layer";
import {
  casePassed,
  describeCaseFailures,
  readRuleFixtures,
  type FixtureCoverage,
  type FixtureFinding,
} from "./fixtures";
import { runSgFixtures } from "./sg-fixtures";
import {
  AST_GREP_TSX_SPLIT,
  AST_GREP_VERSION,
  astGrepLanguageList,
  resolveAstGrepLanguage,
  type AstGrepLanguage,
} from "./capabilities";
import { ensureTasklessDirectory } from "../filesystem/directory";
import { ruleFilePath } from "./engines";
import { RULE_TESTS_DIRECTORY, RULES_DIRECTORY } from "./layout";
import astGrepJsonSchema from "../generated/ast-grep-rule-schema.json";
import { RULE_EXAMPLES } from "./verify-examples";
import { violate, type RuleViolation } from "./constraints";
import { isValidRuleId } from "./validate-id";
import { parseSgRuleAlone } from "./sg-parse";
import { findSgTraps } from "./sg-traps";

// --- Types ---

export interface LayerResult {
  valid: boolean;
  errors: string[];
  /**
   * The subset of `errors` a published constraint accounts for.
   *
   * Optional because most layer results have nothing attributable to say — a
   * missing rule file and malformed YAML are failures no constraint describes,
   * and giving them a plausible-looking id would send a reader to a rationale
   * that does not explain their failure. Absent means "nothing here maps to a
   * constraint", never "not checked".
   */
  violations?: RuleViolation[];
}

/**
 * Layer 1's verdict, plus anything true about the rule that is worth saying
 * without failing it.
 *
 * `notices` carries the non-fatal half of the `language:` check — an
 * accepted-but-off-list spelling, or a `files:` glob a valid language cannot
 * reach. Separate from `errors` for the same reason `RuleVerification.notices`
 * is: it must be sayable on a rule that passed, and it must not turn CI red.
 *
 * One notice per element, and the two above can both be true of one rule. They
 * used to be joined with a space into a single string, which the renderer then
 * printed behind one `    notice: ` marker as a run-on sentence. Handing back
 * elements is what lets the renderer mark each one.
 */
export interface SchemaLayerResult extends LayerResult {
  notices: string[];
}

export interface RequirementsResult extends LayerResult {
  hasTestFile: boolean;
}

export interface TestLayerResult extends LayerResult {
  /** Cases that came out as their bucket asserts. */
  passed: number;
  /** Cases that did not. */
  failed: number;
  /**
   * Which buckets held cases. Only `"both"` can be `valid: true`: a `fail/`
   * case proves the rule fires, a `pass/` case proves it does not over-fire,
   * and either alone is half a claim. Counted by the CLI over case
   * directories, never read from an engine's summary: `ast-grep test` used to
   * report an empty `invalid:` bucket as `1 passed; 0 failed`.
   */
  fixtures: FixtureCoverage;
  /** Every finding the cases produced, each tagged with its bucket. */
  findings: FixtureFinding[];
}

export interface VerifyResult {
  success: boolean;
  ruleId: string;
  schema: SchemaLayerResult;
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
  // Shared with the Vale path, so a rule that fails validation fails the same
  // way whichever engine wrote it. `pathPrefixed` is the half that differs:
  // ast-grep's messages come from an upstream JSON Schema and are generic
  // ("expected string"), so the path is what makes them actionable.
  return schemaLayer(astGrepRuleSchema.safeParse(ruleData), pathPrefixed);
}

/**
 * The canonical language a misspelling was probably reaching for, if there is
 * an obvious one.
 *
 * Deliberately not a fuzzy match. It folds exactly the two shapes a human
 * types when the canonical name is a word for a symbol — `C#` and `c-sharp`
 * both fold to `csharp` — and otherwise offers nothing, because a wrong guess
 * here costs more than silence: the full accepted list is printed either way.
 */
function suggestLanguage(spelling: string): AstGrepLanguage | undefined {
  return resolveAstGrepLanguage(
    spelling
      .toLowerCase()
      .replaceAll("#", "sharp")
      .replaceAll(/[\s_-]+/g, "")
  );
}

/**
 * The file extensions a `files:` glob explicitly names, lowercased.
 *
 * Only what the glob *states*. `src/**` names none and is not evidence of
 * anything, which is the point: this feeds a check that must never fire on a
 * rule whose scope it cannot actually read.
 */
function globExtensions(glob: string): string[] {
  const segment = glob.split("/").at(-1) ?? "";
  const dot = segment.lastIndexOf(".");
  if (dot === -1) return [];
  const suffix = segment.slice(dot + 1).toLowerCase();
  // `**\/*.{ts,tsx}` — globset supports brace alternation, so one glob can name
  // several extensions.
  const braced = /^\{([^}]*)\}$/.exec(suffix);
  return (braced?.[1] === undefined ? [suffix] : braced[1].split(","))
    .map((extension) => extension.trim())
    .filter((extension) => /^[a-z\d]+$/.test(extension));
}

/**
 * The glob string out of one `files:` entry, in either shape ast-grep accepts.
 *
 * `RuleFileGlob` is `anyOf` a bare pattern string and `{ glob, caseInsensitive? }`
 * (see `src/generated/ast-grep-rule-schema.json`), and `assemble.ts` passes
 * `files:` through untouched, so both shapes reach the binary as written.
 * Reading only the string form would leave the object form scanning nothing,
 * which is a silent pass rather than a missed error message: the check below
 * fires on what a glob *names*, so an entry it cannot read looks exactly like
 * an entry that names nothing.
 */
function globPattern(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "glob" in entry) {
    const { glob } = entry as { glob: unknown };
    if (typeof glob === "string") return glob;
  }
  return undefined;
}

/**
 * The `language:` field, against what ast-grep will actually do with it.
 *
 * Nothing else in the pipeline asks. The vendored JSON Schema types the field
 * as a bare string (its only hint is an `example` of `"typescript"`, which is
 * not even the canonical spelling), so Layer 1's zod pass accepts anything, and
 * the first component with an opinion is the binary at `check` time. Both of
 * its verdicts are bad places to learn this:
 *
 * - A name ast-grep does not recognize fails `SgLang` deserialization, which
 *   aborts parsing of the ONE config Taskless assembles per run. Every other sg
 *   rule goes unreported with it, so a single typo blinds the engine. That is
 *   an error here.
 * - A recognized name for the wrong parser reports nothing at all and is
 *   indistinguishable from a clean codebase. Only the `TypeScript`/`Tsx` pair
 *   can be checked from the rule file alone — see {@link AST_GREP_TSX_SPLIT} —
 *   and it is checked against `files:`, which is the form the trap takes in
 *   practice.
 *
 * Case variants and ast-grep's extension aliases are ACCEPTED, not rejected.
 * ast-grep resolves them itself (`typescript`, `TYPESCRIPT`, `ts` all reach
 * TypeScript at 0.41.0), so failing them would fail rules that demonstrably
 * work — including every rule already written against the lowercase spelling
 * ast-grep's own schema shows as its example. They get a notice instead.
 *
 * See taskless/cli#165.
 */
function validateLanguage(ruleData: Record<string, unknown>): {
  errors: string[];
  violations: RuleViolation[];
  notices: string[];
} {
  const errors: string[] = [];
  const violations: RuleViolation[] = [];
  const notices: string[] = [];

  const declared = ruleData.language;
  // A missing or non-string `language` is already reported — by Layer 2's
  // required-fields pass and by zod respectively — and saying it twice in
  // different words would only make the real message harder to find.
  if (typeof declared !== "string" || declared === "") {
    return { errors, violations, notices };
  }

  const canonical = resolveAstGrepLanguage(declared);
  if (canonical === undefined) {
    const suggestion = suggestLanguage(declared);
    violate(
      { errors, violations },
      "sg-language-accepted",
      `language: "${declared}" is not a language ast-grep ${AST_GREP_VERSION} accepts. ` +
        `It aborts config parsing, so every other sg rule in the project goes unreported too. ` +
        (suggestion === undefined ? "" : `Did you mean "${suggestion}"? `) +
        `Accepted spellings: ${astGrepLanguageList()}.`
    );
    return { errors, violations, notices };
  }

  if (declared !== canonical) {
    notices.push(
      `language: "${declared}" works — ast-grep resolves it to ${canonical} — but ${canonical} is how ast-grep spells it.`
    );
  }

  const own = AST_GREP_TSX_SPLIT[canonical];
  const files = ruleData.files;
  if (own !== undefined && Array.isArray(files)) {
    const sibling = own === "ts" ? "tsx" : "ts";
    const siblingLanguage = own === "ts" ? "Tsx" : "TypeScript";
    const named = new Set(
      files
        .map((entry) => globPattern(entry))
        .filter((glob): glob is string => glob !== undefined)
        .flatMap((glob) => globExtensions(glob))
    );
    if (named.has(sibling)) {
      const message =
        `${canonical} does not parse .${sibling} files — ${siblingLanguage} is a separate parser, not an alias, ` +
        `so those globs match nothing and check reports a clean codebase.`;
      if (named.has(own)) {
        notices.push(`files: some globs name .${sibling}. ${message}`);
      } else {
        violate(
          { errors, violations },
          "sg-files-globs-parse",
          `files: every glob names .${sibling}, but language is ${canonical}. ${message}`
        );
      }
    }
  }

  return { errors, violations, notices };
}

// --- Layer 2: Taskless requirements ---

async function validateRequirements(
  cwd: string,
  ruleId: string,
  ruleData: Record<string, unknown>
): Promise<RequirementsResult> {
  const errors: string[] = [];
  const violations: RuleViolation[] = [];
  const collected = { errors, violations };

  // Check required fields
  for (const field of TASKLESS_REQUIRED_FIELDS) {
    if (
      !(field in ruleData) ||
      ruleData[field] === undefined ||
      ruleData[field] === null ||
      ruleData[field] === ""
    ) {
      violate(
        collected,
        "sg-required-fields",
        `Missing required field: ${field}`
      );
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
        for (const message of findRegexWithoutKind(
          container as Record<string, unknown>
        )) {
          violate(collected, "sg-regex-needs-kind", message);
        }
      } else {
        // constraints/utils are Record<string, RuleObject>
        for (const [name, value] of Object.entries(
          container as Record<string, unknown>
        )) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const message of findRegexWithoutKind(
              value as Record<string, unknown>,
              `${key}.${name}`
            )) {
              violate(collected, "sg-regex-needs-kind", message);
            }
          }
        }
      }
    }
  }

  // `strictness:` at the top level is accepted by ast-grep and ignored, so the
  // pattern keeps narrowing exactly as before. Inside `rule:` the same key is a
  // schema error; up here only this check can say so.
  if ("strictness" in ruleData) {
    violate(
      collected,
      "sg-no-top-level-strictness",
      "strictness: at the top level of the rule file is ignored by ast-grep, so the pattern keeps its default `smart` strictness. Move it into the pattern object it is meant for (`pattern: { context: ..., selector: ..., strictness: ast }`)."
    );
  }

  // The rule's own `id:` must be the directory it lives in.
  //
  // The directory name IS the rule id: it is what `check` and `verify` address,
  // what `--filter` is built from, and what a person types to delete a rule.
  // ast-grep registers a rule under the id in its BODY, so a mismatch splits
  // those two apart and both halves fail differently:
  //
  //   `verify` sees nothing — `--filter ^<directory>$` selects no rule, so every
  //   `fail/` case reads as a rule that did not fire, which sends the author
  //   to the pattern rather than to the name.
  //
  //   `check` DOES run it, and that is the worse half. The scan works and the
  //   finding is real, but it is reported under the body's id — a name that
  //   exists in no directory. Anyone who tries to find, disable or delete the
  //   rule that produced it is looking for something that is not there.
  //
  // Checked here, in layer 2, because it needs no subprocess and because the
  // failure it prevents is silent in exactly the direction `validate` is meant to
  // be trusted for. A generated rule whose delivery appends a batch suffix to
  // the filename and not to the body lands in precisely this state.
  const declaredId = ruleData.id;
  if (typeof declaredId === "string" && declaredId !== ruleId) {
    violate(
      collected,
      "sg-id-matches-directory",
      `id: "${declaredId}" does not match the rule's directory "${ruleId}". ` +
        `The directory name is the rule id — it is what \`check\` and \`verify\` ` +
        `address and what you would type to delete it — while ast-grep ` +
        `registers the rule under the id in this file. With the two apart, ` +
        `\`verify\` cannot find the rule at all and \`check\` reports findings ` +
        `under "${declaredId}", a name no directory has. Rename one to match ` +
        `the other.`
    );
  }

  // Whether any case exists, not whether the cases cover both buckets:
  // `validate` must pass a rule whose author has written one side so far, and
  // coverage is `verify`'s question. A layout `readRuleFixtures` refuses is
  // left to `verify` too, where the refusal is reported in full.
  let hasTestFile = false;
  try {
    const fixtures = await readRuleFixtures(cwd, "sg", ruleId);
    hasTestFile = fixtures.coverage !== "none";
  } catch {
    hasTestFile = true;
  }
  if (!hasTestFile) {
    violate(
      collected,
      "sg-test-file-required",
      `No fixture cases found for rule "${ruleId}" in ` +
        `.taskless/${RULES_DIRECTORY}/sg/${ruleId}/${RULE_TESTS_DIRECTORY}/pass/ ` +
        `or ${RULE_TESTS_DIRECTORY}/fail/`
    );
  }

  return { valid: errors.length === 0, errors, violations, hasTestFile };
}

// --- Layer 3: Fixture cases ---

/**
 * Run every fixture case through the scan `check` runs. See `sg-fixtures.ts`.
 */
async function runTests(cwd: string, ruleId: string): Promise<TestLayerResult> {
  const run = await runSgFixtures(cwd, ruleId);
  const findings = run.outcomes.flatMap((outcome) => outcome.findings);
  if (run.errors.length > 0) {
    return {
      valid: false,
      errors: run.errors,
      passed: 0,
      failed: 0,
      fixtures: run.coverage,
      findings,
    };
  }
  const errors = describeCaseFailures(cwd, run.outcomes, run.scope);
  const passed = run.outcomes.filter((outcome) => casePassed(outcome)).length;
  return {
    valid: run.coverage === "both" && errors.length === 0,
    errors,
    passed,
    failed: run.outcomes.length - passed,
    fixtures: run.coverage,
    findings,
  };
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
      fixtures: "none",
      findings: [],
    };
  }
  if (hasTestFile) return runTests(cwd, ruleId);
  return {
    valid: false,
    errors: ["Skipped: no fixture cases found"],
    passed: 0,
    failed: 0,
    fixtures: "none",
    findings: [],
  };
}

export interface VerifyRuleOptions {
  /**
   * Run Layer 3 — every fixture case, through the scan. Defaults to `true`.
   *
   * `false` stops after Layers 1–2, for a caller that only needs to know the
   * rule is well-formed. Layer 3 writes an ast-grep config and spawns a
   * subprocess per case, so a caller that runs `verifyRule` for its schema verdict and
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
      schema: { valid: false, errors: [errorMessage], notices: [] },
      requirements: { valid: false, errors: [errorMessage] },
      tests: {
        valid: false,
        errors: [errorMessage],
        passed: 0,
        failed: 0,
        fixtures: "none",
        findings: [],
      },
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
        notices: [],
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
        fixtures: "none",
        findings: [],
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
      schema: { valid: false, errors: [message], notices: [] },
      requirements: {
        valid: false,
        errors: ["Cannot check requirements: invalid YAML"],
      },
      tests: {
        valid: false,
        errors: ["Cannot run tests: invalid YAML"],
        passed: 0,
        failed: 0,
        fixtures: "none",
        findings: [],
      },
    };
  }

  const ruleRecord = (
    ruleData && typeof ruleData === "object" && !Array.isArray(ruleData)
      ? ruleData
      : {}
  ) as Record<string, unknown>;

  // Layer 1, plus the `language:` field the vendored JSON Schema cannot type.
  const parsed = validateSchema(ruleData);
  const language = validateLanguage(ruleRecord);
  const schemaErrors = [...parsed.errors, ...language.errors];
  // Then the engine itself, over this rule alone, for what no schema can
  // decide (a `kind` the grammar does not have). Only once the schema passes:
  // a rule it already rejects would draw a second, vaguer message for the
  // same defect. Unattributed, because the refusal is the engine's own rule
  // and not one of ours.
  if (schemaErrors.length === 0) {
    const refusal = await parseSgRuleAlone(cwd, ruleId);
    if (refusal !== undefined) schemaErrors.push(refusal);
  }
  const schemaResult: SchemaLayerResult = {
    valid: schemaErrors.length === 0,
    errors: schemaErrors,
    violations: language.violations,
    notices: [...language.notices, ...findSgTraps(ruleRecord)],
  };

  // Layer 2
  const requirementsResult = await validateRequirements(
    cwd,
    ruleId,
    ruleRecord
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
