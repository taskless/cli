import { describe, expect, it } from "vitest";

import { verification, type VerifyStatus } from "../src/rules/inspect";
import { outputSchema } from "../src/schemas/rule-check";

const BODY = {
  engine: "sg" as const,
  ruleId: "no-eval",
  errors: [],
  violations: [],
  notices: [],
  findings: [],
  cases: [],
};

/**
 * `status` is the field to branch on, and `ok`, `ran` and `refused` are kept
 * for consumers that read them. They are derived from `status`, so for every
 * outcome they must say the same thing it does. The combination this exists to
 * rule out is `ok: true` with `ran: false`, a rule that never ran reading as a
 * pass to anything that checks `ok` alone.
 */
describe("a verification's legacy fields agree with its status", () => {
  const expected: Record<
    VerifyStatus,
    { ok: boolean; ran: boolean; refused: string | undefined }
  > = {
    passed: { ok: true, ran: true, refused: undefined },
    failed: { ok: false, ran: true, refused: undefined },
    "not-run": { ok: false, ran: false, refused: undefined },
    refused: { ok: false, ran: false, refused: "not blessed" },
  };

  for (const [status, fields] of Object.entries(expected) as [
    VerifyStatus,
    (typeof expected)[VerifyStatus],
  ][]) {
    it(`derives ok, ran and refused for ${status}`, () => {
      const result = verification(
        status === "refused" ? { status, reason: "not blessed" } : { status },
        BODY
      );
      expect(result.status).toBe(status);
      expect(result.ok).toBe(fields.ok);
      expect(result.ran).toBe(fields.ran);
      expect(result.refused).toBe(fields.refused);
      // Absent rather than `undefined`, so `--json` carries no stray key.
      expect("refused" in result).toBe(status === "refused");
    });

    it(`keeps status through the --json schema for ${status}`, () => {
      const result = verification(
        status === "refused" ? { status, reason: "not blessed" } : { status },
        BODY
      );
      const parsed = outputSchema.parse({ ok: false, rules: [result] });
      expect(parsed.rules[0]?.status).toBe(status);
    });
  }
});
