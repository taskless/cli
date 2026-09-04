import type { EngineName } from "../layout";

/**
 * What `verify` enforces beyond the engine's own schema.
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
 * hypothetical: `create-sg-rule.txt` told agents for months that
 * "`verify` never reads `language`", which stopped being true when
 * `validateLanguage` landed. Nothing failed, because prose has no test.
 *
 * `test/rule-constraints.test.ts` builds a rule that violates each entry and
 * asserts `verify` rejects it, keyed on `id`. An entry describing a check that
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
   * Load-bearing for a consumer's eval ORDER, not a detail. A `verify`
   * constraint is decided from the files alone and can be checked before
   * anything runs; a `test` constraint needs the fixtures to execute. Running
   * the cross-comparison before `verify` passes measures the wrong thing, and
   * treating a `test`-time refusal as a `verify` gap sends someone to the wrong
   * layer.
   *
   * The split is not always where it looks. `verify` requires that a test FILE
   * exists, by filename; whether that file is attributed to this rule is
   * decided later, from the `id:` inside it.
   */
  enforcedBy: "verify" | "test";
  /** One line, for a report that lists several. */
  summary: string;
  /** Why it exists, so a reader can tell a house rule from a bug. */
  rationale: string;
}

export const RULE_CONSTRAINTS: readonly RuleConstraint[] = [
  {
    id: "sg-id-matches-directory",
    engine: "sg",
    enforcedBy: "verify",
    summary: "A rule's `id:` must equal the directory it lives in.",
    rationale:
      "The directory name is the rule id: it is what `check` and `test` address, and what a person types to delete a rule. ast-grep registers the rule under the id in its body. With the two apart, `test` cannot find the rule at all, and `check` does run it but reports findings under a name no directory has, so nobody can locate what produced them.",
  },
  {
    id: "sg-regex-needs-kind",
    engine: "sg",
    enforcedBy: "verify",
    summary:
      "A `regex` needs a sibling `kind`, in `rule`, `constraints` and `utils`.",
    rationale:
      "A regex match with no kind to anchor it is ambiguous and slow: it is applied to every node rather than to the one shape the author meant. ast-grep accepts it, so the engine is not the thing that will tell you.",
  },
  {
    id: "sg-language-accepted",
    engine: "sg",
    enforcedBy: "verify",
    summary:
      "`language:` must be a spelling ast-grep itself uses; a resolvable but non-canonical one is a notice.",
    rationale:
      "An unrecognized name aborts config parsing, which takes every other sg rule in the project down with it and reports nothing. That is the loudest possible failure with the quietest possible symptom: a clean report.",
  },
  {
    id: "sg-files-globs-parse",
    engine: "sg",
    enforcedBy: "verify",
    summary:
      "`files:` globs must not name `.tsx` under TypeScript, or `.ts` under Tsx.",
    rationale:
      "A glob naming an extension the language cannot parse matches nothing, so the rule reports a clean codebase rather than an error. Only the TypeScript/Tsx pair is checked, and deliberately so: they are separate parsers rather than aliases, which is the one language/extension mismatch decidable from the rule file alone. No other extension is compared against `language`, so this is narrower than it first reads.",
  },
  {
    id: "sg-required-fields",
    engine: "sg",
    enforcedBy: "verify",
    summary: "`id`, `language`, `severity`, `message` and `rule` are required.",
    rationale:
      "ast-grep needs fewer of these than we do. The extras are what make a finding actionable and a rule addressable once it is on disk.",
  },
  {
    id: "sg-test-file-required",
    engine: "sg",
    enforcedBy: "verify",
    summary: "A rule must ship at least one test file under `.tests/`.",
    rationale:
      "A rule with no fixtures has shown neither that it fires nor that it stays quiet. `verify` requires the file; `test` requires the cases inside it to cover both.",
  },
  {
    id: "sg-fixture-id-matches-rule",
    engine: "sg",
    enforcedBy: "test",
    summary: "A test file's own `id:` must equal the rule id.",
    rationale:
      "Fixtures are attributed by the id inside the file, not by its name. A fixture carrying another rule's id is silently not counted, so a rule that ships one reads as a rule that shipped none. `verify` passes, because the FILE is there; `test` is where it bites.",
  },
];

/** Constraints for one engine. */
export function constraintsFor(engine: EngineName): readonly RuleConstraint[] {
  return RULE_CONSTRAINTS.filter((constraint) => constraint.engine === engine);
}
