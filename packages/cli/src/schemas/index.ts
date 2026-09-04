/**
 * Public entry for `@taskless/cli/schemas`.
 *
 * The shapes this CLI's `--json` output is produced from, as data. A consumer
 * parsing `taskless verify --json` validates against the schema the CLI emits
 * from, rather than against an interface it hand-wrote by reading our output
 * once.
 *
 * ## Why this is published
 *
 * This is `@taskless/cli/layout`'s argument applied to the other half of the
 * contract. A hand-written interface is a copy that nothing checks: the CLI can
 * add a field, change what one means, or extend an enum, and the copy stays
 * confidently wrong until something downstream misbehaves. The Cloud eval team
 * is doing exactly that today against the `verify` envelope.
 *
 * ## What this is NOT
 *
 * Not an SDK. Nothing here performs verification, and no `verify()` or `test()`
 * is exported. Both spawn a vendored platform binary — ast-grep or Vale — so
 * anywhere a function call could run them, `npx @taskless/cli verify --json`
 * runs too: the export would buy a call site, not a capability, while making
 * internal signatures public. The CLI stays the execution surface; this
 * describes what it says.
 *
 * Nothing here reaches the filesystem, a process, the network or the command
 * tree, so a Worker can import it — and the build fails rather than emitting an
 * entry whose graph reaches a host capability. `writeJsonError` is deliberately
 * absent for that reason: it writes to stdout, and a consumer asking what shape
 * an error takes should not thereby acquire something that emits one.
 */

// The `.js` extension is deliberate, for the reason it is on the prompts and
// layout entries: `tsc` copies this specifier verbatim into
// `dist/schemas/index.d.ts`, and an extensionless one fails to resolve for a
// consumer on `moduleResolution: node16`/`nodenext`.
export {
  /**
   * `taskless verify --json` and `taskless test --json`.
   *
   * One envelope for both, because the commands share an implementation and
   * differ only in what they run against each rule.
   */
  outputSchema as verifyTestOutputSchema,
} from "./verify-test.js";

export {
  /** `taskless rule verify <id> --json`, for an ast-grep rule. */
  verifyOutputSchema,
  /** The same, for a Vale rule — a different shape, discriminated on `engine`. */
  valeVerifyOutputSchema,
} from "./rules-verify.js";

export type {
  /**
   * A constraint `verify` or `test` enforces beyond an engine's own schema.
   *
   * The type of the entries in `@taskless/cli/reference.json`'s
   * `constraints[]`, so a consumer reading the corpus and a consumer reading a
   * rejection are working from one definition.
   */
  RuleConstraint,
  /** One constraint a rule broke, as `violations[]` carries it. */
  RuleViolation,
  /** The id of a constraint this CLI publishes. */
  RuleConstraintId,
} from "../rules/constraints.js";

export type {
  /** The stable code an error envelope carries under `--json`. */
  CLIErrorCode,
  /** The envelope itself. Not every `--json` failure is a rule result. */
  CLIErrorEnvelope,
} from "../types/errors.js";
