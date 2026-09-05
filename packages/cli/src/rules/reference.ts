import type { DeliveredFile } from "./deliver";
import {
  ENGINE_LAYOUTS,
  ENGINES,
  RULE_TESTS_DIRECTORY,
  RULES_DIRECTORY,
  TASKLESS_DIRECTORY,
  type EngineName,
  type FixtureLayout,
} from "./layout";
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
export const REFERENCE_SIGNATURE = `1;h=sha-256;d=${"0".repeat(64)}`;

/**
 * Bumped when a consumer would have to change code to keep reading this.
 *
 * 2 — `tests` went from a flat `{ path, content }[]` to an object stating how
 * its files group into cases, and a `layout` block was added naming the tree
 * every path in this document is relative to. Both were facts a consumer could
 * previously only get by transcribing them out of this repository.
 *
 * A consumer that asserts this and stops is behaving correctly, which is what
 * makes the bump a sufficient signal on its own.
 */
export const REFERENCE_VERSION = 2;

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
export const REFERENCE_PROTOCOL = [
  "Generate a rule from `prompt`, using your own pipeline.",
  "Run `taskless verify` over what you generated. It enforces constraints beyond the engine's own schema, listed in `constraints` below, so a rule the engine executes correctly can still be refused. A rule that fails here is not deliverable however well it behaves, and every later step would be measuring the wrong thing. Check `enforcedBy` before concluding anything: some constraints are only decided once the fixtures run.",
  "Run your generated rule against your own cases. It should pass; if it does not, the disagreement is inside your pipeline and nothing below will be informative.",
  "Run your generated rule against `tests` here. A failure means your rule and ours disagree about the subject, and `tests` is the arbiter.",
  "Run the rule in `rule` here against your cases. A failure means your cases and ours disagree, which is worth as much as the previous step and is the one nobody runs.",
];

/** A fixture file, and the rule-relative path it is written to. */
export interface ReferenceFile {
  path: string;
  content: string;
}

/** Which side of the claim a case asserts. */
export type FixtureBucket = "pass" | "fail";

/**
 * One fixture case: the unit a runner is pointed at, and the files it holds.
 *
 * `path` is what the engine is handed, and its kind differs by engine because
 * the engines differ — a directory for `runtime`, whose check is called with
 * that path as its root; the document itself for `vale`, which lints files. The
 * enclosing {@link ReferenceTests.grouping} is what tells a reader which of the
 * two it is looking at, and publishing that is this shape's entire purpose.
 *
 * `files` names paths rather than repeating content. The bytes live once, in
 * {@link ReferenceTests.files}. Two copies of a fixture in one document is a
 * thing that can disagree with itself, and nothing in the artifact could then
 * say which copy is authoritative.
 */
export interface ReferenceCase {
  bucket: FixtureBucket;
  /** The case's own name — a directory name, or a document's filename. */
  name: string;
  /** Rule-relative, and what the runner is given. */
  path: string;
  /** Rule-relative paths, each resolving to an entry in `tests.files`. */
  files: string[];
}

/**
 * A rule's held-out cases, with the grouping stated rather than implied.
 *
 * The flat `{ path, content }[]` this replaces required a consumer to know that
 * a `runtime` case is a directory and a `vale` case is a document before it
 * could tell which files belong together. That fact lives in this repository,
 * so every consumer transcribed it, and a transcribed fact goes stale silently
 * when the layout changes. It cost the Cloud eval team a rule that failed the
 * fixtures shipped beside it (#263): their request format carried one anonymous
 * blob per case, so the two-file `runtime` case could not be expressed and the
 * rule was graded against half of itself.
 *
 * `cases` is absent for `ast-grep-test`, and the absence is a statement. That
 * grouping lives inside ast-grep's own test file, in a schema ast-grep
 * documents and owns; restating it here would move a fact out of the schema
 * that owns it and into a copy this repository would then have to keep true.
 */
export interface ReferenceTests {
  grouping: FixtureLayout;
  files: ReferenceFile[];
  /** Present for every grouping the CLI itself defines. */
  cases?: ReferenceCase[];
}

/** One rule as this corpus carries it. */
export interface ReferenceRule {
  engine: EngineName;
  id: string;
  /**
   * Where this rule's directory goes, relative to the project root.
   *
   * Resolved rather than left to the consumer to assemble from
   * {@link ReferenceLayout.ruleDirectory}. Every other path in this entry is
   * relative to it, and a corpus that publishes relative paths without naming
   * the root is asking a reader to guess where the CLI looks.
   */
  directory: string;
  /**
   * Which file in `rule` *is* the rule, as opposed to its config or its
   * capture rules.
   *
   * `rule` is a flat list: `check.ts` and `captures/env-read.yml` are
   * indistinguishable in it. That was assumable while the corpus held one rule
   * per engine, and stops being assumable the moment it does not.
   */
  ruleFile: string;
  /** The generation request, as a caller would phrase it. */
  prompt: string;
  /** What a generator must produce. Paths are relative to `directory`. */
  rule: ReferenceFile[];
  /** The held-out cases both sides' rules must satisfy. */
  tests: ReferenceTests;
  /** Present only where execution is gated on it. See the constant's note. */
  signature?: string;
}

/** One engine's slot in the layout table, as the corpus publishes it. */
export interface ReferenceEngineLayout {
  /** `{id}` where the name follows the rule id, a constant where it does not. */
  ruleFile: string;
  ruleConfigFile: string | null;
  capturesDirectory: string | null;
  fixtureLayout: FixtureLayout;
}

/**
 * The tree every path in this document is relative to.
 *
 * Published because the corpus is otherwise a set of paths with no stated root,
 * and a consumer materializing a rule — one of ours to run `taskless verify`
 * against, or its own generated answer to the same prompt, which has to land
 * somewhere the CLI will look — would have to assume where that is.
 *
 * Both the template and each entry's resolved {@link ReferenceRule.directory}
 * are published, deliberately. The resolved path needs no substitution and
 * covers the rules in this file; the template covers the rule a consumer just
 * generated, which is not in this file at all. Publishing only the resolved
 * paths would leave three examples from which the pattern has to be inferred,
 * which is the same guess in a smaller costume.
 *
 * `{engine}` and `{id}` are literal placeholders and the only two. This is not
 * a path DSL: `ruleFile` differs by engine as a function of the id — `{id}.yml`
 * for the document engines, a constant `check.ts` for `runtime`, because a
 * runtime rule is a program — and that difference is the thing worth
 * publishing as data rather than describing in prose.
 *
 * Generated from {@link ENGINE_LAYOUTS}, the table the CLI itself dispatches
 * on, so this cannot describe a layout the CLI does not implement.
 */
export interface ReferenceLayout {
  rulesRoot: string;
  ruleDirectory: string;
  testsDirectory: string;
  engines: Record<EngineName, ReferenceEngineLayout>;
}

export interface Reference {
  version: number;
  protocol: string[];
  layout: ReferenceLayout;
  /**
   * What `verify` and `test` enforce beyond the engine's own schema.
   *
   * Published because a generator that never reads our recipes cannot know
   * them, and because without the list a refusal here is indistinguishable
   * from a disagreement about the subject. Each entry says which command
   * enforces it, which decides the order an eval has to run in.
   */
  constraints: RuleConstraint[];
  rules: ReferenceRule[];
}

/** The input shape `buildReference` reads, satisfied by both callers. */
export interface ReferenceInput {
  engine: EngineName;
  ruleId: string;
  prompt: string;
  ruleFiles: readonly DeliveredFile[];
  testFiles: readonly DeliveredFile[];
}

/**
 * The placeholder a template stands the rule id in for.
 *
 * `ENGINE_LAYOUTS[engine].ruleFile` is a function of the rule id, so calling it
 * with this recovers the template it applies — `{id}.yml` where the name
 * follows the id, `check.ts` where it does not. Derived rather than transcribed:
 * an engine that changes how it names its rule file changes what is published
 * here, with nothing to keep in step.
 */
const ID_PLACEHOLDER = "{id}";

const RULES_ROOT = `${TASKLESS_DIRECTORY}/${RULES_DIRECTORY}`;

/** The rule directory for an engine and id, as a consumer must spell it. */
function referenceRuleDirectory(engine: string, ruleId: string): string {
  return `${RULES_ROOT}/${engine}/${ruleId}`;
}

const REFERENCE_LAYOUT: ReferenceLayout = {
  rulesRoot: RULES_ROOT,
  ruleDirectory: referenceRuleDirectory("{engine}", ID_PLACEHOLDER),
  testsDirectory: RULE_TESTS_DIRECTORY,
  engines: Object.fromEntries(
    ENGINES.map((engine) => {
      const layout = ENGINE_LAYOUTS[engine];
      return [
        engine,
        {
          ruleFile: layout.ruleFile(ID_PLACEHOLDER),
          // `null` rather than an absent key: a consumer reading JSON cannot
          // tell a field this engine does not have from a field the corpus
          // forgot to write.
          ruleConfigFile: layout.ruleConfigFile ?? null,
          capturesDirectory: layout.capturesDirectory ?? null,
          fixtureLayout: layout.fixtureLayout,
        },
      ];
    })
  ) as Record<EngineName, ReferenceEngineLayout>,
};

const plain = (files: readonly DeliveredFile[]): ReferenceFile[] =>
  files.map((file) => ({ path: file.path, content: file.content }));

/**
 * The bucket and remaining segments of a fixture path, or a thrown explanation.
 *
 * Every fixture lives under `.tests/<bucket>/…`. A path that does not is not a
 * case this corpus can group, and the generator REFUSES rather than emitting a
 * corpus whose grouping is a guess — a mis-grouped case is exactly the defect
 * publishing the grouping exists to prevent, and it would be published as fact.
 */
function fixtureSegments(
  ruleId: string,
  path: string
): { bucket: FixtureBucket; rest: string[] } {
  const segments = path.split("/");
  const [tests, bucket, ...rest] = segments;
  if (
    tests !== RULE_TESTS_DIRECTORY ||
    (bucket !== "pass" && bucket !== "fail")
  )
    throw new Error(
      `${ruleId}: fixture ${path} is not under ${RULE_TESTS_DIRECTORY}/pass/ ` +
        `or ${RULE_TESTS_DIRECTORY}/fail/, so the corpus cannot say which case ` +
        `it belongs to.`
    );
  if (rest.length === 0)
    throw new Error(
      `${ruleId}: fixture ${path} is the bucket directory itself, not a case.`
    );
  return { bucket, rest };
}

/**
 * Group a rule's fixture files into cases, by the layout its engine declares.
 *
 * Keyed on `fixtureLayout` rather than on the engine name, so this reads the
 * same fact the fixture runners implement instead of restating it. A fourth
 * engine states its layout in the table and is grouped here without a change.
 */
function groupCases(
  engine: EngineName,
  ruleId: string,
  files: ReferenceFile[]
): ReferenceCase[] | undefined {
  const grouping = ENGINE_LAYOUTS[engine].fixtureLayout;
  if (grouping === "ast-grep-test") return undefined;

  const cases = new Map<string, ReferenceCase>();
  for (const file of files) {
    const { bucket, rest } = fixtureSegments(ruleId, file.path);
    // A document engine's case IS the file; a directory engine's case is the
    // first segment below the bucket, and everything deeper is its tree.
    const name = rest[0] ?? "";
    if (grouping === "case-documents" && rest.length > 1)
      throw new Error(
        `${ruleId}: ${file.path} is nested, but a ${engine} case is one ` +
          `document. Vale lints the rule's whole directory, so a nested ` +
          `fixture is linted and never attributed to a case.`
      );
    // The opposite rejection, and it is the one `bucketCases` already makes
    // when the runner reads these buckets off disk. Publishing a bare file as
    // a one-file "case" would emit a corpus indistinguishable in shape from a
    // valid `case-documents` one, that `taskless test` throws on.
    if (grouping === "case-directories" && rest.length === 1)
      throw new Error(
        `${ruleId}: ${file.path} is a bare file, but a ${engine} case is a ` +
          `directory. The check is handed the case directory as its root and ` +
          `reads the files it needs beneath it, so a bare file in ${bucket}/ ` +
          `has no root to be and would never run.`
      );

    const path = `${RULE_TESTS_DIRECTORY}/${bucket}/${name}`;
    const existing = cases.get(path);
    if (existing === undefined) {
      cases.set(path, { bucket, name, path, files: [file.path] });
    } else {
      existing.files.push(file.path);
    }
  }
  return [...cases.values()];
}

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
export function buildReference(rules: readonly ReferenceInput[]): Reference {
  return {
    version: REFERENCE_VERSION,
    protocol: REFERENCE_PROTOCOL,
    layout: REFERENCE_LAYOUT,
    constraints: [...RULE_CONSTRAINTS],
    rules: rules.map((rule) => {
      const files = plain(rule.testFiles);
      const cases = groupCases(rule.engine, rule.ruleId, files);
      return {
        engine: rule.engine,
        id: rule.ruleId,
        directory: referenceRuleDirectory(rule.engine, rule.ruleId),
        ruleFile: ENGINE_LAYOUTS[rule.engine].ruleFile(rule.ruleId),
        prompt: rule.prompt,
        rule: plain(rule.ruleFiles),
        tests: {
          grouping: ENGINE_LAYOUTS[rule.engine].fixtureLayout,
          files,
          ...(cases === undefined ? {} : { cases }),
        },
        ...(rule.engine === "runtime"
          ? { signature: REFERENCE_SIGNATURE }
          : {}),
      };
    }),
  };
}
