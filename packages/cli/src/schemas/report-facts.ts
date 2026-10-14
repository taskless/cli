import { z } from "zod";

/**
 * What the agent knows that the CLI cannot: the facts `taskless report --from`
 * reads.
 *
 * NOT A REPORTV1. The CLI builds the report; the agent supplies only what its
 * session taught it. Every object is strict, so a field someone else owns —
 * the `violations` and `files` the CLI measures, the monthly rates tskl.es
 * derives — is refused rather than quietly merged, and the agent hears that it
 * tried to set something it does not own.
 *
 * Embedded into the `report` recipe as JSON Schema, so the recipe and this
 * file cannot describe two different shapes.
 */

const count = z.number().int().min(0);

const isoDate = z.iso.date().describe("A calendar date, YYYY-MM-DD");

const ruleId = z
  .string()
  .regex(/^[\dA-Za-z][\w.-]*$/)
  .max(128)
  .describe(
    "The rule's id: its directory name, or one you choose for a rule outside .taskless/"
  );

const surfaced = z
  .object({
    prs: count.describe(
      "Pull or merge requests merged in the window with at least one review comment asking for what this rule enforces"
    ),
    reviewComments: count.describe(
      "Review comments on those pull requests that ask for what this rule enforces, judged by reading each one. Bot and author comments count"
    ),
  })
  .strict()
  .describe("How often review raised this rule's pattern over the window");

const outcome = {
  title: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "What the rule enforces, in a phrase a reader of the report understands"
    ),
  surfaced,
};

const fixture = z
  .string()
  .min(1)
  .describe(
    "A short code sample; withheld if it holds anything you cannot vouch for"
  );

/** Facts about a rule already under `.taskless/rules/`. */
const localRuleFacts = z.object({ id: ruleId, ...outcome }).strict();

/** A rule the agent wrote into the repository's own linter. */
const legacyRuleFacts = z
  .object({
    id: ruleId,
    ...outcome,
    tool: z
      .string()
      .regex(/^[\w@./+-]+$/)
      .max(64)
      .describe("The linter it lives in, e.g. eslint, ruff, rubocop"),
    language: z.string().min(1).max(40),
    fail: fixture.optional().describe("Code the rule flags"),
    pass: fixture.optional().describe("Code the rule accepts"),
  })
  .strict();

/** A runtime-shaped candidate the agent did not author. */
const cloudCandidateFacts = z
  .object({
    id: ruleId,
    ...outcome,
    language: z.string().min(1).max(40),
    complexity: z
      .number()
      .gt(0)
      .max(100)
      .nullable()
      .describe("Rough calls per check for a runtime rule, or null if unknown"),
    fail: fixture.optional().describe("Code the rule would flag"),
    pass: fixture.optional().describe("Code the rule would accept"),
  })
  .strict();

export const reportFactsSchema = z
  .object({
    window: z
      .object({ from: isoDate, to: isoDate })
      .strict()
      .describe("The span of history you mined"),
    label: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "A name for the repository when it has no GitHub origin; defaults to its directory name"
      ),
    history: z
      .object({
        mergedPrs: count,
        reviewComments: count,
        agentAssistedPrs: count.describe(
          "Merged pull requests an agent helped write, as far as you can tell"
        ),
        patterns: z
          .object({
            ruleShaped: count.describe(
              "Recurring review patterns a rule could enforce"
            ),
            judgment: count.describe(
              "Recurring review patterns that need human judgment"
            ),
          })
          .strict(),
      })
      .strict()
      .describe(
        "What the window's history held. Zeros are honest when there was nothing to mine"
      ),
    rules: z
      .array(localRuleFacts)
      .describe("One entry per rule the draft listed under `rules`"),
    legacy: z
      .array(legacyRuleFacts)
      .default([])
      .describe("Rules you wrote into the repository's own linter"),
    cloud: z
      .array(cloudCandidateFacts)
      .default([])
      .describe("Runtime-shaped candidates you did not author"),
    estimates: z
      .object({
        contextTokens: z
          .number()
          .int()
          .gt(0)
          .max(10_000_000)
          .describe(
            "Tokens in a typical session of this user's, from what you have seen"
          ),
        callsPerCatch: z
          .number()
          .gt(0)
          .max(1000)
          .describe(
            "Extra agent turns a missed issue costs this user before it is fixed"
          ),
      })
      .strict(),
    redaction: z
      .object({
        counts: z
          .object({
            secret: count,
            email: count,
            person: count,
            customer: count,
            host: count,
            ip: count,
            phone: count,
            text: count,
          })
          .partial()
          .strict()
          .default({})
          .describe("What you removed or withheld yourself, by kind"),
        withheld: z
          .array(
            z.object({ id: ruleId, side: z.enum(["fail", "pass"]) }).strict()
          )
          .default([])
          .describe("Fixtures you chose not to publish"),
      })
      .strict()
      .default({ counts: {}, withheld: [] }),
  })
  .strict();

export type ReportFacts = z.infer<typeof reportFactsSchema>;
