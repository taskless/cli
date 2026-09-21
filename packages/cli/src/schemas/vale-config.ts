/**
 * The schema for a rule's own `.vale.ini`, keyed by the rule's directory id.
 *
 * The counterpart of `vale-rule.ts` for the other file a Vale rule ships. The
 * style YAML has been validated since the engine landed; the config was carried
 * into the assembled run config as verbatim text, and `verify` asked two
 * questions of it by substring. Nothing checked that a matcher carried its
 * breadcrumb, that a value was `YES` or `NO`, that an assignment named this
 * rule and not a neighbour, or that the run-level keys stayed out. Each of
 * those is a config Vale accepts and reads as something other than what its
 * author wrote, with a zero exit and an empty report.
 *
 * ## Shape
 *
 * The file is parsed into an ordered AST with `@jedmao/ini-parser` and every
 * check is a refinement over that structure. Nothing here matches the file's
 * text: the only place the source string is read after parsing is
 * {@link locateLines}, which finds the 1-based line a node came from so a
 * message can name it, and which validates nothing.
 *
 * The parser was chosen by measurement against four alternatives, recorded in
 * taskless/cli#359. The `ini` lineage nests section names on `.` and loses
 * source order, both fatal for a file whose sections are globs and whose order
 * is its precedence; `iniparser` drops the `tskl) rule` key; and
 * `config-ini-parser` truncates it to `rule`. Two of its options are
 * load-bearing: `resolve: false`, because the default JSON-parses values and a
 * `[2024/**]` matcher's neighbour `2024` would come back a number; and
 * `delimiter: /=/`, because the default also splits on `:`, which a glob may
 * contain. Its `toString()` is measured not round-trip safe and is never
 * called; assembly writes the source bytes.
 *
 * Two things the parser does that this module undoes, both in
 * {@link parseValeRuleConfig}:
 *
 * - A blank line is reported as a new section with an empty name, and the
 *   lines after it land in that section rather than the matcher they belong
 *   to. Such a section is folded back into the one before it (or into the root
 *   when nothing precedes it), which is how Vale reads the file. A literal
 *   `[]` header is indistinguishable from a blank line in the AST and folds
 *   the same way; it names no file and is not a matcher anyone writes.
 * - Root properties, the ones above the first `[matcher]`, arrive as a
 *   section with no name at all. They are kept apart from the matchers because
 *   the first rejection below is about exactly them.
 *
 * ## Rejections and advisories
 *
 * A rejection is a config no author means. An advisory has a legitimate
 * reading, which is what separates the two lists. Every rejection is paired
 * with a `vale-config-*` entry in `RULE_CONSTRAINTS`, so `verify --json` can
 * attribute it the way it already does for ast-grep.
 *
 * One measured limit, in the too-strict direction: Vale strips an inline
 * comment from a value (`YES # note` enables the rule), while the parser under
 * `resolve: false` keeps it, so that line is rejected here with the value shown
 * as Vale would not have read it. The message quotes the value, so the fix is
 * visible in the report.
 */

import iniParser from "@jedmao/ini-parser";
import { z } from "zod";

import { VALE_VERSION } from "../rules/capabilities";
import type { RuleViolation } from "../rules/constraints";

/**
 * The parser class, whichever way the module arrived.
 *
 * `@jedmao/ini-parser` is CommonJS with an `__esModule` marker and
 * `exports.default = Parser`. A bundler honours the marker and hands the class
 * to a default import; Node's own ESM loader does not, and hands the whole
 * `module.exports` object, on which the class sits under `.default`. Vitest
 * externalises dependencies and loads them through Node, the built CLI loads
 * them through the bundle, so both shapes are real and both are handled.
 */
type IniParser = typeof iniParser;
const Parser: IniParser =
  (iniParser as unknown as { default?: IniParser }).default ?? iniParser;

// --- The AST -----------------------------------------------------------------

/** One `key = value` line. `value` is `""` for `key =` and for a bare key. */
export interface ValeConfigProperty {
  kind: "property";
  key: string;
  value: string;
  /** 1-based line in the source, when it could be located. */
  line?: number;
}

/** One `#` or `;` line, kept so the structure stays lossless and ordered. */
export interface ValeConfigComment {
  kind: "comment";
  text: string;
  line?: number;
}

export type ValeConfigNode = ValeConfigProperty | ValeConfigComment;

/**
 * One `[matcher]` and the lines under it, or the root when `name` is absent.
 *
 * The root is the run of lines above the first `[matcher]`. Vale reads keys
 * there as run-level settings, which is why a rule config must not have any.
 */
export interface ValeConfigSection {
  name?: string;
  nodes: ValeConfigNode[];
  /** 1-based line of the `[matcher]` header, when it could be located. */
  line?: number;
}

/** A rule's `.vale.ini`, parsed. Sections are in source order. */
export interface ValeRuleConfigAst {
  sections: ValeConfigSection[];
}

/**
 * Attach source lines to an AST by walking the two side by side.
 *
 * The parser carries no positions, so this walks the source's non-blank lines
 * in order against the AST's sections and nodes in order: a line opening with
 * `[` is the next section's header, and any other non-blank line is the next
 * node in the current section. The header is checked against the section's
 * name as a guard, and the walk stops assigning at the first disagreement (an
 * escaped name, a `[]` header that was folded), so a message either names the
 * right line or names none. A wrong line number sends a reader somewhere the
 * problem is not, which is worse than no number.
 *
 * This is the one function that reads the source after parsing. It decides
 * nothing about validity.
 */
function locateLines(source: string, sections: ValeConfigSection[]): void {
  const lines = source.split(/\r?\n/);
  let sectionIndex = sections[0]?.name === undefined ? 0 : -1;
  let nodeIndex = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const lineNumber = index + 1;
    if (line.startsWith("[")) {
      sectionIndex += 1;
      nodeIndex = 0;
      const section = sections[sectionIndex];
      if (section?.name === undefined || line !== `[${section.name}]`) return;
      section.line = lineNumber;
      continue;
    }
    const node = sections[sectionIndex]?.nodes[nodeIndex];
    if (node === undefined) return;
    nodeIndex += 1;
    node.line = lineNumber;
  }
}

/**
 * Parse a rule's `.vale.ini` into an ordered AST.
 *
 * Blank-line sections are folded into their predecessor (see the module
 * comment), the root section is the one with no name, and every node carries
 * the source line it came from when that could be located.
 */
export function parseValeRuleConfig(source: string): ValeRuleConfigAst {
  const parser = new Parser({ resolve: false, delimiter: /=/ });
  const sections: ValeConfigSection[] = [];
  for (const item of parser.parse(source).items) {
    const nodes: ValeConfigNode[] = item.nodes.map((node) =>
      "key" in node
        ? {
            kind: "property",
            key: node.key,
            // `resolve: false` guarantees a string when there is a value; a
            // bare key or `key =` comes back `undefined` or `""`.
            value: typeof node.value === "string" ? node.value : "",
          }
        : { kind: "comment", text: node.text }
    );
    const previous = sections.at(-1);
    if (item.name === "") {
      // A blank line, not a matcher. Its nodes belong to whatever came before
      // it; with nothing before, they are root properties.
      if (previous === undefined) {
        if (nodes.length > 0) sections.push({ nodes });
      } else {
        previous.nodes.push(...nodes);
      }
      continue;
    }
    if (item.name === undefined) {
      sections.push({ nodes });
      continue;
    }
    sections.push({ name: item.name, nodes });
  }
  locateLines(source, sections);
  return { sections };
}

// --- The schema --------------------------------------------------------------

const propertySchema = z.object({
  kind: z.literal("property"),
  key: z.string(),
  value: z.string(),
  line: z.number().optional(),
});

const commentSchema = z.object({
  kind: z.literal("comment"),
  text: z.string(),
  line: z.number().optional(),
});

const sectionSchema = z.object({
  name: z.string().optional(),
  nodes: z.array(z.discriminatedUnion("kind", [propertySchema, commentSchema])),
  line: z.number().optional(),
});

const astSchema = z.object({ sections: z.array(sectionSchema) });

/** The key every matcher must carry, naming the rule whose config it is in. */
export const VALE_BREADCRUMB_KEY = "tskl) rule";

const BASED_ON_STYLES_KEY = "BasedOnStyles";

/** The constraint ids this schema can attribute a rejection to. */
export type ValeConfigConstraintId = Extract<
  RuleViolation["constraintId"],
  `vale-config-${string}`
>;

function at(node: { line?: number }): string {
  return node.line === undefined ? "" : ` line ${String(node.line)}`;
}

function matcherLabel(section: ValeConfigSection): string {
  return `[${section.name ?? ""}]`;
}

/** `ruleId/.vale.ini line N:` — the prefix every message shares. */
function where(ruleId: string, node: { line?: number }): string {
  return `${ruleId}/.vale.ini${at(node)}:`;
}

function properties(section: ValeConfigSection): ValeConfigProperty[] {
  return section.nodes.filter((node) => node.kind === "property");
}

/**
 * A rule's config, validated against the rule it belongs to.
 *
 * Every refinement pushes a `custom` issue whose `params.constraintId` names
 * the `RULE_CONSTRAINTS` entry it enforces, which is what lets
 * {@link validateValeRuleConfig} attribute the rejection without matching on
 * its own wording.
 */
function valeRuleConfigSchema(ruleId: string) {
  const ownKey = `${ruleId}.${ruleId}`;
  return astSchema.check((context) => {
    const { sections } = context.value;
    const fail = (
      constraintId: ValeConfigConstraintId,
      path: PropertyKey[],
      message: string
    ): void => {
      context.issues.push({
        code: "custom",
        input: context.value,
        path,
        message,
        params: { constraintId },
      });
    };

    const matchers = sections.filter(
      (section) => section.name !== undefined
    ) as (ValeConfigSection & { name: string })[];

    // Root: anything assigned above the first matcher. Vale reads it as a
    // run-level key, warns W101 if it does not recognise it, and either way
    // it enables nothing.
    for (const [index, section] of sections.entries()) {
      if (section.name !== undefined) continue;
      for (const property of properties(section)) {
        fail(
          "vale-config-no-root-keys",
          ["sections", index],
          `${where(ruleId, property)} "${property.key}" is assigned above the first [matcher]. ` +
            `Vale reads it as a run-level setting and ignores a rule assignment there (W101). ` +
            `StylesPath and MinAlertLevel are set by the assembled run config; a rule assignment belongs inside a matcher.`
        );
      }
    }

    if (matchers.length === 0) {
      fail(
        "vale-config-matcher-required",
        ["sections"],
        `${ruleId}/.vale.ini declares no matcher, so the rule is scoped to nothing and will never run.`
      );
      return;
    }

    /**
     * Each matcher's FINAL verdict on the rule, folded by name and in the
     * order the names first appear.
     *
     * Vale merges every `[glob]` section with the same name into one matcher
     * and keeps the last assignment, so a `YES` followed by a `NO`, in one
     * section or across two same-glob sections, is a matcher that says `NO`.
     * The two checks below read these verdicts rather than any single
     * assignment, because a config whose only `YES` is overridden that way
     * leaves the rule present but off, which is the silent disable this
     * schema exists to refuse. `enabledSomewhere` records whether a `YES` was
     * ever written, which only decides how that rejection is worded.
     */
    const verdicts = new Map<
      string,
      { section: ValeConfigSection; verdict: "YES" | "NO" | undefined }
    >();
    let enabledSomewhere = false;

    for (const section of matchers) {
      const path = ["sections", sections.indexOf(section)];
      const label = matcherLabel(section);
      const assignments = properties(section);
      const folded = verdicts.get(section.name) ?? {
        section,
        verdict: undefined,
      };
      verdicts.set(section.name, folded);

      const breadcrumb = assignments.find(
        (property) => property.key === VALE_BREADCRUMB_KEY
      );
      if (breadcrumb === undefined) {
        fail(
          "vale-config-breadcrumb-required",
          path,
          `${where(ruleId, section)} matcher ${label} has no "${VALE_BREADCRUMB_KEY} = ${ruleId}" breadcrumb, ` +
            `so nothing attributes it to ${ruleId} once every rule's config is assembled into one file.`
        );
      } else if (breadcrumb.value !== ruleId) {
        fail(
          "vale-config-breadcrumb-required",
          path,
          `${where(ruleId, breadcrumb)} matcher ${label} carries "${VALE_BREADCRUMB_KEY} = ${breadcrumb.value}", ` +
            `but this is ${ruleId}'s config. The breadcrumb names the rule whose config it is in.`
        );
      }

      for (const property of assignments) {
        if (property.key === VALE_BREADCRUMB_KEY) continue;
        if (property.key === BASED_ON_STYLES_KEY) {
          if (property.value !== "") {
            fail(
              "vale-config-based-on-styles-empty",
              path,
              `${where(ruleId, property)} matcher ${label} sets BasedOnStyles = "${property.value}". ` +
                `It must be empty: a bundled style loaded here fires alongside ${ruleId} and reaches every rule whose matchers overlap.`
            );
          }
          continue;
        }
        if (property.key !== ownKey) {
          const foreign = property.key.includes(".");
          fail(
            "vale-config-own-key-only",
            path,
            foreign
              ? `${where(ruleId, property)} matcher ${label} assigns "${property.key}", which names another rule. ` +
                  `A rule's config may only enable or disable itself, as ${ownKey}; anything else is a cross-rule override.`
              : `${where(ruleId, property)} matcher ${label} assigns "${property.key}", which is not a per-rule setting. ` +
                  `Inside a matcher a rule's config carries only "${VALE_BREADCRUMB_KEY}", an empty BasedOnStyles, and ${ownKey}.`
          );
          continue;
        }
        if (property.value !== "YES" && property.value !== "NO") {
          fail(
            "vale-config-value-yes-no",
            path,
            `${where(ruleId, property)} ${ownKey} = "${property.value}" is not YES or NO. ` +
              `Vale ${VALE_VERSION} reads a level name here as an override of the style's own level, and anything else as off, without saying so.`
          );
          continue;
        }
        folded.verdict = property.value;
        if (property.value === "YES") enabledSomewhere = true;
      }
    }

    const final = [...verdicts.values()];
    const firstYes = final.findIndex((entry) => entry.verdict === "YES");
    if (firstYes === -1) {
      fail(
        "vale-config-enabled-somewhere",
        ["sections"],
        enabledSomewhere
          ? `${ruleId}/.vale.ini enables ${ownKey} only where a later assignment to the same matcher turns it off again, so the rule is present but off.`
          : `${ruleId}/.vale.ini never enables ${ownKey}, so the rule is present but off.`
      );
      return;
    }

    // Ordering: a NO-verdict matcher before every YES-verdict matcher. With
    // BasedOnStyles empty the rule is off until a YES, so such a NO is dead
    // where nothing else matches and overridden where the later YES does.
    // Reported against the first YES, which is the one that re-enables it.
    const enabler = final[firstYes]?.section;
    if (enabler === undefined) return;
    for (const { section, verdict } of final.slice(0, firstYes)) {
      if (verdict !== "NO") continue;
      fail(
        "vale-config-disable-after-enable",
        ["sections", sections.indexOf(section)],
        `${where(ruleId, section)} matcher ${matcherLabel(section)} disables ${ruleId} before any matcher enables it, ` +
          `and ${matcherLabel(enabler)}${at(enabler)} re-enables it afterwards, so this NO is either dead or overridden. ` +
          `Precedence is positional: move the NO after the YES it narrows.`
      );
    }
  });
}

// --- Advisories --------------------------------------------------------------

/** The tree `check` excludes before Vale runs. */
const TASKLESS_TREE_PREFIX = ".taskless/";

/**
 * What is true about a config that does not make it invalid.
 *
 * Each of these has a legitimate reading, so none is a rejection: a repeated
 * key may be a deliberate override an author is mid-way through, `[*]` may be
 * meant, and a `.taskless/**` matcher is harmless, only unnecessary. They are
 * said rather than refused.
 */
function adviseValeRuleConfig(
  ruleId: string,
  ast: ValeRuleConfigAst
): string[] {
  const advisories: string[] = [];
  /**
   * Assignments seen per matcher name. Keyed by name rather than by section
   * because Vale merges duplicate `[glob]` sections, so a key assigned once in
   * each is a repeat in the config Vale reads.
   */
  const seen = new Map<string, Map<string, ValeConfigProperty>>();

  for (const section of ast.sections) {
    if (section.name === undefined) continue;
    const label = matcherLabel(section);

    if (section.name === "*") {
      advisories.push(
        `${where(ruleId, section)} matcher [*] enables ${ruleId} for every file Vale can read, code included. ` +
          `Narrow it to the prose it is for (for example [*.md]) unless that is meant.`
      );
    }
    if (section.name.startsWith(TASKLESS_TREE_PREFIX)) {
      advisories.push(
        `${where(ruleId, section)} matcher ${label} is unnecessary: check excludes .taskless/ before Vale runs, ` +
          `so it acts only under a bare vale invocation.`
      );
    }

    const assignments =
      seen.get(section.name) ?? new Map<string, ValeConfigProperty>();
    seen.set(section.name, assignments);
    for (const property of properties(section)) {
      if (property.key === VALE_BREADCRUMB_KEY) continue;
      const earlier = assignments.get(property.key);
      if (earlier !== undefined) {
        advisories.push(
          `${where(ruleId, property)} matcher ${label} assigns ${property.key} again (first${at(earlier)}). ` +
            `Vale ${VALE_VERSION} keeps the last assignment, "${property.value}"; through 3.20.0 it kept the first.`
        );
      }
      assignments.set(property.key, property);
    }
  }
  return advisories;
}

// --- The verdict -------------------------------------------------------------

/** What the schema concluded about one rule's config. */
export interface ValeRuleConfigVerdict {
  /** Configs no author means, each attributed to its constraint. */
  rejections: RuleViolation[];
  /** True things about the config that do not make it invalid. */
  advisories: string[];
  /** Every matcher's pattern, in source order, exactly as the header spells it. */
  sections: string[];
}

/**
 * Validate a rule's `.vale.ini` against the rule it belongs to.
 *
 * `ruleId` is the rule's directory name, which is what the assembled config
 * resolves `<id>.<id>` against. `source` is the file's text; it is parsed here
 * and never re-serialised.
 */
export function validateValeRuleConfig(
  ruleId: string,
  source: string
): ValeRuleConfigVerdict {
  const ast = parseValeRuleConfig(source);
  const result = valeRuleConfigSchema(ruleId).safeParse(ast);
  const rejections: RuleViolation[] = result.success
    ? []
    : result.error.issues.map((issue) => {
        // Every issue this schema raises is a `custom` one carrying its
        // constraint; a structural issue would mean the AST builder and the
        // schema disagree, which is a bug here rather than in the config, and
        // it is surfaced as such rather than swallowed.
        const attribution =
          issue.code === "custom"
            ? (issue.params as { constraintId?: ValeConfigConstraintId })
            : undefined;
        if (attribution?.constraintId === undefined) {
          throw new Error(
            `vale-config schema raised an issue with no constraint: ${issue.message}`
          );
        }
        return {
          constraintId: attribution.constraintId,
          message: issue.message,
        };
      });
  return {
    rejections,
    advisories: adviseValeRuleConfig(ruleId, ast),
    sections: ast.sections
      .map((section) => section.name)
      .filter((name): name is string => name !== undefined),
  };
}
