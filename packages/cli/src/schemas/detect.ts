import { z } from "zod";

/** A linter detected from configuration on disk */
const detectedLinterSchema = z.object({
  name: z.string().describe("Linter identifier, e.g. eslint, ruff, rubocop"),
  evidence: z
    .array(z.string())
    .describe(
      "On-disk evidence: config-file paths, a manifest table or section marker, a dependency marker from the language's package file, or a root CI or hook config that runs the linter (not all entries are file paths)"
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

/**
 * A command-line tool looked for on the host's `PATH`. Presence only: the file
 * was found, nothing was run.
 */
const hostToolSchema = z.object({
  name: z.string().describe("The command as typed, e.g. gh, glab, git, jq"),
  present: z
    .boolean()
    .describe("A file of this name is on PATH; Taskless did not run it"),
  path: z.string().optional().describe("Where it was found, when present"),
  applicable: z
    .boolean()
    .describe(
      "The tool could accomplish something in this repository (gh needs a GitHub origin, glab a GitLab one)"
    ),
  reason: z
    .string()
    .optional()
    .describe("Why the tool is not applicable, when it is not"),
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
  hostTools: z
    .array(hostToolSchema)
    .describe("Command-line tools looked for on PATH, in a fixed order"),
  agent: z
    .record(z.string(), z.string())
    .describe(
      "Commands an agent may choose to run, keyed by command, each with what it tells the agent. Only present, applicable tools get one; detect runs none of them"
    ),
});

// On the (internal-only) error path `detect` emits the standard
// `{ ok: false, code, message }` envelope via makeErrorEnvelope — there is no
// command-specific error schema to keep in sync.
