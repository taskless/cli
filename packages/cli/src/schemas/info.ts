import { z } from "zod";

const skillStatusSchema = z.object({
  name: z.string(),
  installedVersion: z.string().optional(),
  currentVersion: z.string(),
  current: z.boolean(),
});

const toolStatusSchema = z.object({
  name: z.string(),
  skills: z.array(skillStatusSchema),
});

const authSchema = z.object({
  user: z.string(),
  email: z.string(),
  orgs: z.array(z.string()),
});

export const outputSchema = z.object({
  success: z.literal(true),
  version: z.string().describe("CLI version"),
  tools: z.array(toolStatusSchema).describe("Detected tools and skill status"),
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
});

export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Error message"),
});
