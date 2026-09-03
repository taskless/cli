import type { DeliveredFile } from "../deliver";

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
 */
export const DEMO_REFERENCE_SIGNATURE = `1;h=sha-256;d=${"0".repeat(64)}`;

/** Fixed, because the payload is data rather than the record of a request. */
export const DEMO_REFERENCE_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

export interface DemoReference {
  requestId: string;
  status: "generated";
  rules: {
    id: string;
    engine: "runtime";
    signature: string;
    files: { path: string; content: string }[];
  }[];
}

/**
 * The demonstration rule in the retrieval response shape.
 *
 * Built from {@link DeliveredFile} rather than restating the file list, so the
 * reference and the rule the CLI writes cannot describe different things.
 */
export function buildDemoReference(
  ruleId: string,
  files: readonly DeliveredFile[]
): DemoReference {
  return {
    requestId: DEMO_REFERENCE_REQUEST_ID,
    status: "generated",
    rules: [
      {
        id: ruleId,
        engine: "runtime",
        signature: DEMO_REFERENCE_SIGNATURE,
        files: files.map((file) => ({
          path: file.path,
          content: file.content,
        })),
      },
    ],
  };
}
