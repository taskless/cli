import { z } from "zod";

const skillStatusSchema = z.object({
  name: z.string(),
  installedVersion: z.string().optional(),
  currentVersion: z.string(),
  current: z.boolean(),
});

const harnessStatusSchema = z.object({
  name: z.string(),
  skills: z.array(skillStatusSchema),
});

/**
 * A command-line tool found on `PATH`.
 *
 * `present` is established by looking for a file of that name and nothing
 * else: the CLI does not spawn a detected binary, read its version, or hash
 * it, so a consumer must read this as presence rather than as a working
 * install. `applicable` is the separate question of whether the tool could
 * accomplish anything here at all — `gh` in a repository with no GitHub
 * `origin` is present and inapplicable, and must not be reported as missing.
 */
const hostToolSchema = z.object({
  name: z.string(),
  present: z.boolean(),
  path: z.string().optional(),
  applicable: z.boolean(),
});

const authSchema = z.object({
  user: z.string(),
  email: z.string(),
  orgs: z.array(z.string()),
});

export const outputSchema = z.object({
  success: z.literal(true),
  version: z.string().describe("CLI version"),
  harnesses: z
    .array(harnessStatusSchema)
    .describe(
      "Detected agent harnesses and their skill status. Published under " +
        "the key `tools` before that name was given to the CLI binaries " +
        "below; the entry shape is unchanged."
    ),
  tools: z
    .array(hostToolSchema)
    .describe(
      "Command-line tools found on PATH. Presence only: nothing is executed"
    ),
  loggedIn: z.boolean().describe("Whether the user is authenticated"),
  auth: authSchema.optional().describe("User identity if logged in"),
  repositoryUrl: z
    .string()
    .nullable()
    .describe(
      "Canonical GitHub repository URL, or null when none is resolvable"
    ),
  ghOwner: z
    .string()
    .describe(
      "GitHub owner segment, or the literal `[unknown]` when none is resolvable"
    ),
  install: z
    .object({
      cliVersion: z.string().nullable(),
      onboarded: z
        .boolean()
        .describe(
          "Whether onboarding has been marked complete. Absent in the " +
            "manifest reads as false here, matching the gate `onboard` " +
            "itself applies (`manifest.install?.onboarded === true`)."
        ),
    })
    .describe("How the scaffold got here: the CLI that last wrote it"),
  rules: z
    .object({
      reconciledTo: z.string().nullable(),
      engines: z.object({
        sg: z.string().nullable(),
        vale: z.string().nullable(),
      }),
      walk: z
        .object({ from: z.string(), to: z.string() })
        .nullable()
        .describe(
          "Where a ledger walk should start and end, or null when there is nothing to walk. Computed here so a caller does not re-derive the boundary"
        ),
    })
    .describe(
      "What the rules are valid against. Distinct from `install`: these advance only on a completed reconciliation, never on an upgrade"
    ),
});

export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
});
