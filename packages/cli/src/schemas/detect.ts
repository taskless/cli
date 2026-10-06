import { z } from "zod";

/** A linter detected from configuration on disk */
const detectedLinterSchema = z.object({
  name: z.string().describe("Linter identifier, e.g. eslint, ruff, rubocop"),
  evidence: z
    .array(z.string())
    .describe(
      "On-disk evidence: config-file paths, a pyproject table marker, or a dependency marker from the language's package file (not all entries are file paths)"
    ),
});

/** A surfaced style of the repo's own existing rules */
const ruleStyleSchema = z.object({
  source: z
    .string()
    .describe("Where the existing rules live, e.g. .taskless/rules"),
  description: z
    .string()
    .describe("How the repo authors rules of this kind, for downstream reuse"),
});

/** A CI system or commit-time tool configured at the scan root */
const detectedAutomationSchema = z.object({
  name: z
    .string()
    .describe("Identifier, e.g. github-actions, gitlab-ci, husky, lint-staged"),
  evidence: z
    .array(z.string())
    .describe(
      "What matched: a path relative to the scan root, or a package.json key or dependency marker"
    ),
});

/** Output schema for `taskless detect --json` on success */
export const outputSchema = z.object({
  success: z.literal(true),
  linters: z
    .array(detectedLinterSchema)
    .describe("Linters configured in the working directory"),
  languages: z
    .array(z.string())
    .describe("Languages inferred from manifests and detected linters"),
  ruleStyles: z
    .array(ruleStyleSchema)
    .describe("Styles of the repo's own existing rules"),
  ci: z
    .array(detectedAutomationSchema)
    .describe("CI systems configured at the scan root"),
  hooks: z
    .array(detectedAutomationSchema)
    .describe(
      "Tools that run commands at commit time (hook managers and lint-staged), configured at the scan root"
    ),
});

// On the (internal-only) error path `detect` emits the standard
// `{ ok: false, code, message }` envelope via makeErrorEnvelope — there is no
// command-specific error schema to keep in sync.
