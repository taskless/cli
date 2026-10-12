import type { EngineName } from "./layout";

/**
 * What `validate` enforces beyond the engine's own schema.
 *
 * ## Why this exists
 *
 * A rule the engine executes correctly can still be refused. Those refusals are
 * deliberate, but they are OURS, and a generator that never reads our recipes
 * cannot know them. Published in the conformance corpus so an external eval can
 * tell "your rule is wrong about the subject" from "your rule broke a house
 * rule it was never told about" — two findings that want completely different
 * responses.
 *
 * ## Why every entry has a test that triggers it
 *
 * A hand-maintained list of what code does goes stale, and this is not
 * hypothetical: `create-sg-rule.md` told agents for months that
 * "`validate` never reads `language`", which stopped being true when
 * `validateLanguage` landed. Nothing failed, because prose has no test.
 *
 * `test/constraints.test.ts` builds a rule that violates each entry and
 * asserts `validate` rejects it, keyed on `id`. An entry describing a check that
 * no longer fires fails the suite; a check with no entry is invisible to that
 * test and is the gap this list is trying to close, so add one when you add a
 * check.
 */
export interface RuleConstraint {
  /** Stable key. Consumers branch on this; renaming is breaking. */
  id: string;
  engine: EngineName;
  /**
   * Which command refuses the rule.
   *
   * Load-bearing for a consumer's eval ORDER, not a detail. A `validate`
   * constraint is decided from the files alone and can be checked before
   * anything runs; a `verify` constraint needs the fixtures to execute. Running
   * the cross-comparison before `validate` passes measures the wrong thing, and
   * treating a `verify`-time refusal as a `validate` gap sends someone to the wrong
   * layer.
   *
   * The split is not always where it looks. `validate` requires that a test FILE
   * exists, by filename; whether that file is attributed to this rule is
   * decided later, from the `id:` inside it.
   */
  enforcedBy: "validate" | "verify";
  /** One line, for a report that lists several. */
  summary: string;
  /** Why it exists, so a reader can tell a house rule from a bug. */
  rationale: string;
}

/**
 * One constraint a rule broke, paired with the message that reports it.
 *
 * Emitted alongside `errors` rather than replacing it. A consumer mapping a
 * rejection back to the rationale we already wrote had only our wording to
 * match on, and wording is not a contract: rephrasing an error message is not
 * a breaking change, so a text match rots without anything reporting it.
 *
 * The message is repeated rather than joined to `errors` by index. An index
 * join is a contract nobody can see, and it breaks the first time either side
 * filters or reorders. Repeating the string lets a consumer ignore `errors`
 * entirely.
 */
export interface RuleViolation {
  constraintId: RuleConstraintId;
  message: string;
}

export const RULE_CONSTRAINTS = [
  {
    id: "sg-id-matches-directory",
    engine: "sg",
    enforcedBy: "validate",
    summary: "A rule's `id:` must equal the directory it lives in.",
    rationale:
      "The directory name is the rule id: it is what `check` and `verify` address, and what a person types to delete a rule. ast-grep registers the rule under the id in its body. With the two apart, `verify` cannot find the rule at all, and `check` does run it but reports findings under a name no directory has, so nobody can locate what produced them.",
  },
  {
    id: "sg-regex-needs-kind",
    engine: "sg",
    enforcedBy: "validate",
    summary:
      "A `regex` needs a sibling `kind`, in `rule`, `constraints` and `utils`.",
    rationale:
      "A regex match with no kind to anchor it is ambiguous and slow: it is applied to every node rather than to the one shape the author meant. ast-grep accepts it, so the engine is not the thing that will tell you.",
  },
  {
    id: "sg-language-accepted",
    engine: "sg",
    enforcedBy: "validate",
    summary:
      "`language:` must be a spelling ast-grep itself uses; a resolvable but non-canonical one is a notice.",
    rationale:
      "An unrecognized name aborts config parsing, which takes every other sg rule in the project down with it and reports nothing. That is the loudest possible failure with the quietest possible symptom: a clean report.",
  },
  {
    id: "sg-files-globs-parse",
    engine: "sg",
    enforcedBy: "validate",
    summary:
      "`files:` globs must not name `.tsx` under TypeScript, or `.ts` under Tsx.",
    rationale:
      "A glob naming an extension the language cannot parse matches nothing, so the rule reports a clean codebase rather than an error. Only the TypeScript/Tsx pair is checked, and deliberately so: they are separate parsers rather than aliases, which is the one language/extension mismatch decidable from the rule file alone. No other extension is compared against `language`, so this is narrower than it first reads.",
  },
  {
    id: "sg-no-top-level-strictness",
    engine: "sg",
    enforcedBy: "validate",
    summary:
      "`strictness:` belongs inside a pattern object, never at the top level of the rule file.",
    rationale:
      "ast-grep accepts a top-level `strictness:` and ignores it, so the pattern keeps its default `smart` strictness and goes on narrowing exactly as it did before the author tried to widen it. Inside `rule:` the same key is a schema error, which is loud; at the top level it is silent, so only this check can say so.",
  },
  {
    id: "sg-required-fields",
    engine: "sg",
    enforcedBy: "validate",
    summary: "`id`, `language`, `severity`, `message` and `rule` are required.",
    rationale:
      "ast-grep needs fewer of these than we do. The extras are what make a finding actionable and a rule addressable once it is on disk.",
  },
  {
    id: "sg-test-file-required",
    engine: "sg",
    enforcedBy: "validate",
    summary: "A rule must ship at least one test file under `.tests/`.",
    rationale:
      "A rule with no fixtures has shown neither that it fires nor that it stays quiet. `validate` requires the file; `verify` requires the cases inside it to cover both.",
  },
  {
    id: "sg-fixture-id-matches-rule",
    engine: "sg",
    enforcedBy: "verify",
    summary: "A test file's own `id:` must equal the rule id.",
    rationale:
      "Fixtures are attributed by the id inside the file, not by its name. A fixture carrying another rule's id is silently not counted, so a rule that ships one reads as a rule that shipped none. `validate` passes, because the FILE is there; `verify` is where it bites.",
  },
  // --- Vale: the rule's own `.vale.ini`, checked as a parsed structure -------
  //
  // Every entry below is decided by `schemas/vale-config.ts` over the ini AST,
  // never over the file's text. The common thread is that Vale accepts each of
  // these configs and does something other than what the author wrote, with a
  // zero exit and an empty report: the rule validates, runs, and finds nothing.
  //
  // `enforcedBy` reads `validate` for all of them even though `check` runs the
  // same schema and refuses the Vale run on a rejection. The field answers a
  // consumer's ordering question — can this be decided from the files alone,
  // before anything executes? — and for every entry here it can. `validate` is
  // where the author is told which line and which constraint; `check` only
  // refuses, and points back at `validate`.
  {
    id: "vale-config-no-root-keys",
    engine: "vale",
    enforcedBy: "validate",
    summary:
      "A rule's `.vale.ini` assigns nothing above its first matcher; `StylesPath` and `MinAlertLevel` belong to the run.",
    rationale:
      "Vale reads a rule assignment placed above the first `[matcher]` as a run-level key, warns `W101` on stderr, ignores it, and exits zero. The rule validates clean while enabled nowhere. `StylesPath` and `MinAlertLevel` are properties of the assembled run config, which sets both; a per-rule copy is either redundant or silently fights the header.",
  },
  {
    id: "vale-config-breadcrumb-required",
    engine: "vale",
    enforcedBy: "validate",
    summary:
      "Every matcher carries a `tskl) rule = <id>` breadcrumb naming the rule whose config it is in.",
    rationale:
      "The breadcrumb is how a matcher is attributed once every rule's config is concatenated into the one file Vale reads. A matcher without one is an orphan in the assembled config: nothing can say which rule it came from, and the migration that split the old shared config left exactly such matchers behind as unattributable hand edits. Vale ignores the key, so it costs nothing at run time.",
  },
  {
    id: "vale-config-own-key-only",
    engine: "vale",
    enforcedBy: "validate",
    summary:
      "Inside a matcher, the only assignments are the breadcrumb and `<id>.<id>`.",
    rationale:
      "A `<style>.<check>` key naming any other rule is a cross-rule override, and a rule cannot know its own position in the assembled file, so whether the override wins depends on directory sort order. Any other key is a run-level or Vale-wide setting placed where it would apply to every rule after it. The per-rule layout exists to remove that coupling; this is what enforces it.",
  },
  {
    id: "vale-config-value-yes-no",
    engine: "vale",
    enforcedBy: "validate",
    summary: "`<id>.<id>` is assigned exactly `YES` or `NO`.",
    rationale:
      "Vale also accepts a level name here (`warning`, `error`) to override the style's own, which would make the rule's severity depend on its config rather than its style file, and it reads anything else as `NO` without saying so. A rule's scope is a yes-or-no question, and its level is answered once, in the style.",
  },
  {
    id: "vale-config-no-based-on-styles",
    engine: "vale",
    enforcedBy: "validate",
    summary: "No matcher sets `BasedOnStyles`, empty or otherwise.",
    rationale:
      "Measured on Vale 3.22.0, an empty `BasedOnStyles` clears every setting a file inherited from an earlier matcher (upstream c2d62437), and the assembled run config interleaves every rule's matchers in id order. A rule writing `BasedOnStyles =` under `[docs/**]` therefore silences every alphabetically earlier rule under `docs/`, and only byte-identical globs, which Vale merges into one section, escape it. Through 3.21.0 the line was inert. A non-empty value was always refused: `BasedOnStyles = Vale` loads a whole bundled style alongside the rule and reaches every rule whose matchers overlap. Neither value was ever needed. Vale loads no bundled style unless a run-level `BasedOnStyles` names one, and the assembled header names none, so a rule enables itself by name and the key has no job in a rule's config.",
  },
  {
    id: "vale-config-matcher-required",
    engine: "vale",
    enforcedBy: "validate",
    summary: "A rule's `.vale.ini` declares at least one `[matcher]`.",
    rationale:
      "A Vale rule is enabled only inside a matcher, so a config with none scopes the rule to nothing. Vale accepts the file and the rule never runs. That is the silent disable this engine's design exists to prevent.",
  },
  {
    id: "vale-config-enabled-somewhere",
    engine: "vale",
    enforcedBy: "validate",
    summary: "Some matcher assigns `<id>.<id> = YES`.",
    rationale:
      "No style is loaded, so a rule is off until a matcher turns it on. A config whose every matcher says `NO`, or none says anything, leaves the rule present but off: it validates, it is assembled, and it reports nothing.",
  },
  {
    id: "vale-config-disable-after-enable",
    engine: "vale",
    enforcedBy: "validate",
    summary:
      "A `NO` matcher comes after the `YES` it narrows, never before every `YES`.",
    rationale:
      "Matcher precedence is positional: where two matchers match a file, the later wins. A `NO` that precedes every `YES` is therefore either dead (the file matched nothing else, and the rule was already off) or overridden by the `YES` that follows it. Measured against the pinned Vale, `[docs/legacy/**] NO` then `[docs/**] YES` fires in `docs/legacy/`. No config means that, so it is refused rather than reported.",
  },
] as const satisfies readonly RuleConstraint[];

/**
 * The id of a constraint this CLI publishes.
 *
 * Derived from the list rather than declared beside it, so a violation can only
 * name a constraint that is actually published. Attributing a rejection to an
 * id no consumer can look up would be worse than attributing nothing.
 */
export type RuleConstraintId = (typeof RULE_CONSTRAINTS)[number]["id"];

/**
 * Record an attributable failure in both places at once.
 *
 * `errors` stays the complete list and `violations` the attributable subset, so
 * a consumer reading only `errors` sees exactly what it saw before this
 * existed. Written through one call because two arrays maintained separately is
 * how the message in one comes to differ from the message in the other.
 */
export function violate(
  target: { errors: string[]; violations: RuleViolation[] },
  constraintId: RuleConstraintId,
  message: string
): void {
  target.errors.push(message);
  target.violations.push({ constraintId, message });
}

/** Constraints for one engine. */
export function constraintsFor(engine: EngineName): readonly RuleConstraint[] {
  return RULE_CONSTRAINTS.filter((constraint) => constraint.engine === engine);
}
