import { z } from "zod";

/** Output schema for `taskless rule revisions --json` on success */
export const outputSchema = z.object({
  success: z.literal(true),
  ruleId: z
    .string()
    .describe(
      "The rule's id: its directory name under `.taskless/rules/<engine>/`"
    ),
  revisions: z
    .array(
      z.object({
        revisionId: z
          .string()
          .describe("Pass to `rule rollback` to make this revision current"),
        createdAt: z.string().describe("When the revision was generated"),
        delivery: z
          .enum(["cli", "pull-request"])
          .describe("How the revision was delivered"),
        requestId: z.string().describe("The request that produced it"),
        prUrl: z
          .string()
          .optional()
          .describe(
            "The pull request that delivered it; only for pull-request delivery"
          ),
        current: z
          .boolean()
          .describe(
            "Whether it is the rule's current revision. At most one is, and none is while the rule exists only on an unmerged pull request"
          ),
      })
    )
    .describe(
      "Newest first, followed by the current revision when it is older than those. Find the current one by `current`, not by position"
    ),
  truncated: z
    .boolean()
    .describe(
      "Whether older revisions exist that this listing omits; the Taskless dashboard lists every one"
    ),
});
