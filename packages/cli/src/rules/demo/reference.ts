import type { DeliveredFile } from "../deliver";
import type { EngineName } from "../layout";
import { RULE_CONSTRAINTS, type RuleConstraint } from "./constraints";

/**
 * A deliberately invalid signature, well-formed and unmistakably synthetic.
 *
 * A runtime rule's execution is gated on its signature, so a payload carrying
 * one has to say something, and the question is only what.
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
 * and both tiers are inert, so a signature on them would imply a gate that does
 * not exist.
 */
export const DEMO_REFERENCE_SIGNATURE = `1;h=sha-256;d=${"0".repeat(64)}`;

/** Bumped when a consumer would have to change code to keep reading this. */
export const DEMO_REFERENCE_VERSION = 1;

/**
 * The check this corpus exists to make possible, stated in the artifact itself.
 *
 * A conformance corpus that does not say what to do with it gets read as a
 * pile of examples. The point is the CROSS: each side's rule graded against the
 * other side's cases, because a rule graded only on the cases shipped beside it
 * is graded on nothing.
 *
 * The `verify` step is second rather than implied, and it is there because
 * running this protocol found it. A hand-written alternate `sg` rule that
 * ast-grep executed CORRECTLY — matching `eval(payload)` and not
 * `JSON.parse(payload)` — was refused by `taskless verify` for using `regex`
 * without a sibling `kind`. That is a deliberate house constraint and not a
 * bug, but nothing in the prompt states it, so a generator cannot know it and
 * the failure reads as a disagreement about the subject when it is a
 * disagreement about our validator. Any consumer would have hit it on their
 * first run.
 */
export const DEMO_REFERENCE_PROTOCOL = [
  "Generate a rule from `prompt`, using your own pipeline.",
  "Run `taskless verify` over what you generated. It enforces constraints beyond the engine's own schema, listed in `constraints` below, so a rule the engine executes correctly can still be refused. A rule that fails here is not deliverable however well it behaves, and every later step would be measuring the wrong thing. Check `enforcedBy` before concluding anything: some constraints are only decided once the fixtures run.",
  "Run your generated rule against your own cases. It should pass; if it does not, the disagreement is inside your pipeline and nothing below will be informative.",
  "Run your generated rule against `tests` here. A failure means your rule and ours disagree about the subject, and `tests` is the arbiter.",
  "Run the rule in `rule` here against your cases. A failure means your cases and ours disagree, which is worth as much as the previous step and is the one nobody runs.",
];

/** One rule as this corpus carries it. */
export interface DemoReferenceRule {
  engine: EngineName;
  id: string;
  /** The generation request, as a caller would phrase it. */
  prompt: string;
  /** What a generator must produce. Paths are relative to the rule directory. */
  rule: { path: string; content: string }[];
  /** The held-out cases both sides' rules must satisfy. */
  tests: { path: string; content: string }[];
  /** Present only where execution is gated on it. See the constant's note. */
  signature?: string;
}

export interface DemoReference {
  version: number;
  protocol: string[];
  /**
   * What `verify` and `test` enforce beyond the engine's own schema.
   *
   * Published because a generator that never reads our recipes cannot know
   * them, and because without the list a refusal here is indistinguishable
   * from a disagreement about the subject. Each entry says which command
   * enforces it, which decides the order an eval has to run in.
   */
  constraints: RuleConstraint[];
  rules: DemoReferenceRule[];
}

/** The input shape `buildDemoReference` reads, satisfied by both callers. */
export interface DemoReferenceInput {
  engine: EngineName;
  ruleId: string;
  prompt: string;
  ruleFiles: readonly DeliveredFile[];
  testFiles: readonly DeliveredFile[];
}

const plain = (files: readonly DeliveredFile[]) =>
  files.map((file) => ({ path: file.path, content: file.content }));

/**
 * The shipped demonstration rules as a conformance corpus.
 *
 * `rule` and `tests` are separate on purpose, and it is the whole reason this
 * shape is not simply the retrieval envelope. A delivery hands over one flat
 * file set because a client only has to write it; a conformance check has to
 * tell the claim from the oracle, so that either side's rule can be run against
 * either side's cases. From one flat list, the two interesting runs — their
 * rule on our cases, our rule on theirs — cannot be set up at all.
 *
 * Built from the rules rather than restating them, so the corpus and what the
 * CLI writes cannot describe different things.
 */
export function buildDemoReference(
  rules: readonly DemoReferenceInput[]
): DemoReference {
  return {
    version: DEMO_REFERENCE_VERSION,
    protocol: DEMO_REFERENCE_PROTOCOL,
    constraints: [...RULE_CONSTRAINTS],
    rules: rules.map((rule) => ({
      engine: rule.engine,
      id: rule.ruleId,
      prompt: rule.prompt,
      rule: plain(rule.ruleFiles),
      tests: plain(rule.testFiles),
      ...(rule.engine === "runtime"
        ? { signature: DEMO_REFERENCE_SIGNATURE }
        : {}),
    })),
  };
}
