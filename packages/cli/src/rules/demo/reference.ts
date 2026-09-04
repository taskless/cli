import type { DeliveredFile } from "../deliver";
import type { EngineName } from "../layout";

/**
 * A deliberately invalid signature, well-formed and unmistakably synthetic.
 *
 * The retrieval schema makes `signature` REQUIRED on a runtime rule, because
 * execution is gated on it — so a reference payload has to carry one, and the
 * question is only which.
 *
 * It parses. `1;h=sha-256;d=<64 hex>` is exactly the envelope grammar, so this
 * value reaches the COMPARISON and fails there, which is the half of the gate
 * worth demonstrating. A malformed signature would be rejected by the parser
 * instead and would exercise the wrong thing entirely.
 *
 * And it is all zeros, so it can never be mistaken for a blessed signature, or
 * copied out of this file into something that would run. A plausible-looking
 * digest here would be a hash of nothing pretending to be a hash of something.
 *
 * Carried ONLY by the runtime rule. On `sg` and `vale` the field is optional
 * and both tiers are inert, so a fake signature on them would imply a gate that
 * does not exist.
 */
export const DEMO_REFERENCE_SIGNATURE = `1;h=sha-256;d=${"0".repeat(64)}`;

/** Fixed, because the payload is data rather than the record of a request. */
export const DEMO_REFERENCE_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

/** One rule as the retrieval response carries it. */
export interface DemoReferenceRule {
  id: string;
  engine: EngineName;
  files: { path: string; content: string }[];
  signature?: string;
}

export interface DemoReference {
  requestId: string;
  status: "generated";
  rules: DemoReferenceRule[];
}

/** The input shape `buildDemoReference` reads, satisfied by both callers. */
export interface DemoReferenceInput {
  engine: EngineName;
  ruleId: string;
  files: readonly DeliveredFile[];
}

/**
 * The shipped demonstration rules in the retrieval response shape.
 *
 * One payload carrying all three rather than three payloads, because that is
 * the shape a real request produces: `rules[]` already holds several, and a
 * consumer writing an eval against this should be reading the same envelope
 * their client reads.
 *
 * Built from the rules rather than restating them, so the reference and what
 * the CLI writes cannot describe different things.
 */
export function buildDemoReference(
  rules: readonly DemoReferenceInput[]
): DemoReference {
  return {
    requestId: DEMO_REFERENCE_REQUEST_ID,
    status: "generated",
    rules: rules.map((rule) => ({
      id: rule.ruleId,
      engine: rule.engine,
      files: rule.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      // Only where execution is gated on it. See the constant's note.
      ...(rule.engine === "runtime"
        ? { signature: DEMO_REFERENCE_SIGNATURE }
        : {}),
    })),
  };
}
