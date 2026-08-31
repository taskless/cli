/**
 * Public entry for `@taskless/cli/layout`.
 *
 * The rule layout table, as data: which engines exist, what file *is* the rule
 * for each of them, where its per-engine config and capture rules live, and the
 * directory names the whole tree hangs off. A rule is one directory,
 * `.taskless/rules/<engine>/<id>/`, and this describes its contents.
 *
 * These are the same values the CLI itself dispatches on — not a copy kept in
 * step, the actual module. Nothing here reaches the filesystem, the network,
 * telemetry, or the command tree, so a Worker can import it; the build fails
 * rather than emitting an entry whose graph reaches a host capability.
 *
 * ## Why this is published
 *
 * A service that builds a rule payload has to know what a complete rule is for
 * a given engine. The alternative to importing it is transcribing it, and
 * transcription drifts: the same layout was written into seven code comments
 * and one specification here, all naming a path two migrations had already
 * moved, and one of those stale comments carried the wrong layout into a
 * cross-team design document before anyone noticed.
 *
 * ## What it does not tell you
 *
 * Only the shape. Whether a rule *runs* is a separate question with separate
 * answers — a runtime rule executes only against a server-blessed signature
 * over its `check.ts`, and a Vale rule fires only where its own `.vale.ini`
 * scopes it. A file set that satisfies this table is well-formed, not
 * necessarily live.
 */

// The `.js` extension is deliberate, for the same reason it is on the prompts
// entry: this module is the published entry for `@taskless/cli/layout`, so
// `tsc` copies this specifier verbatim into `dist/layout/index.d.ts`. An
// extensionless specifier there fails to resolve for a consumer on
// `moduleResolution: node16`/`nodenext`, which is a trap we would be shipping
// rather than hitting ourselves.
export {
  ENGINES,
  ENGINE_LAYOUTS,
  RULES_DIRECTORY,
  RULE_TESTS_DIRECTORY,
  isKnownEngine,
  type EngineExecutor,
  type EngineLayout,
  type EngineName,
} from "../rules/layout.js";
