import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { VALE_VERSION } from "../src/rules/capabilities";
import {
  parseValeRuleConfig,
  validateValeRuleConfig,
} from "../src/schemas/vale-config";

/**
 * The config schema, over an ini fixture set.
 *
 * One fixture per rejection and per advisory, plus the dogfood shape the
 * schema was written against: three matchers carrying the breadcrumb and
 * `<id>.<id> = YES`, and the trailing `.taskless/**` block that `check` never
 * needs. The `BasedOnStyles =` those matchers used to carry is now its own
 * rejection fixture. Every message is asserted on its text as well as
 * its constraint id, so a fixture refused for some unrelated reason fails here
 * rather than passing quietly.
 *
 * `vale-vendor-contract.test.ts` holds the parser to the binary: for each glob
 * shape in this set, the section names it reads are the matchers Vale enables.
 */

const RULE = "no-simply";
const fixtures = join(import.meta.dirname, "fixtures", "vale-config");

function fixture(name: string): string {
  return readFileSync(join(fixtures, `${name}.ini`), "utf8");
}

function verdict(name: string, ruleId = RULE) {
  return validateValeRuleConfig(ruleId, fixture(name));
}

function ids(result: ReturnType<typeof validateValeRuleConfig>): string[] {
  return result.rejections.map((rejection) => rejection.constraintId);
}

describe("parseValeRuleConfig", () => {
  it("reads the dogfood shape as four matchers in source order", () => {
    const ast = parseValeRuleConfig(fixture("dogfood"));
    expect(ast.sections.map((section) => section.name)).toEqual([
      undefined,
      "*.md",
      "2024/**",
      "docs/[a-z]*.md",
      ".taskless/**",
    ]);
    // The root holds only the two leading comments.
    expect(ast.sections[0]?.nodes.map((node) => node.kind)).toEqual([
      "comment",
      "comment",
    ]);
  });

  it("keeps a numeric-looking glob as a string", () => {
    // The parser's default `resolve` JSON-parses values; the option is off so
    // nothing here is ever a number.
    const ast = parseValeRuleConfig("[2024/**]\nx = 2024\n");
    expect(ast.sections[0]?.name).toBe("2024/**");
    expect(ast.sections[0]?.nodes[0]).toMatchObject({
      kind: "property",
      key: "x",
      value: "2024",
    });
  });

  it("keeps a character-class glob whole", () => {
    const ast = parseValeRuleConfig("[docs/[a-z]*.md]\n");
    expect(ast.sections.map((section) => section.name)).toEqual([
      "docs/[a-z]*.md",
    ]);
  });

  it("keeps the breadcrumb key intact and splits only on =", () => {
    const ast = parseValeRuleConfig(
      "[*.md]\ntskl) rule = no-simply\nkey:with:colons = v\n"
    );
    expect(
      ast.sections[0]?.nodes.map((node) =>
        node.kind === "property" ? [node.key, node.value] : node.text
      )
    ).toEqual([
      ["tskl) rule", "no-simply"],
      ["key:with:colons", "v"],
    ]);
  });

  it("folds a blank line inside a matcher back into that matcher", () => {
    // The parser reports a blank line as a new, unnamed section and puts the
    // lines after it there. Vale reads them as the same matcher.
    const ast = parseValeRuleConfig(fixture("blank-inside-matcher"));
    expect(ast.sections).toHaveLength(1);
    expect(ast.sections[0]?.name).toBe("*.md");
    expect(
      ast.sections[0]?.nodes.map((node) =>
        node.kind === "property" ? node.key : node.text
      )
    ).toEqual(["tskl) rule", "no-simply.no-simply"]);
  });

  it("attaches the source line to every header and property", () => {
    const ast = parseValeRuleConfig(fixture("dogfood"));
    const lines = ast.sections.map((section) => [
      section.line,
      section.nodes.map((node) => node.line),
    ]);
    expect(lines).toEqual([
      [undefined, [1, 2]],
      [3, [4, 5]],
      [7, [8, 9]],
      [11, [12, 13]],
      [15, [16, 17]],
    ]);
  });

  it("parses an empty file to no sections", () => {
    expect(parseValeRuleConfig("").sections).toEqual([]);
  });
});

describe("validateValeRuleConfig accepts", () => {
  it("the dogfood shape, with only the .taskless/** advisory", () => {
    const result = verdict("dogfood");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatch(
      /line 15: matcher \[\.taskless\/\*\*\]/
    );
    expect(result.sections).toEqual([
      "*.md",
      "2024/**",
      "docs/[a-z]*.md",
      ".taskless/**",
    ]);
  });

  it("an enable narrowed by a later disable, with nothing to say", () => {
    const result = verdict("valid");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toEqual([]);
    expect(result.sections).toEqual(["*.md", "docs/legacy/**"]);
  });

  it("a matcher with a blank line inside it", () => {
    expect(verdict("blank-inside-matcher").rejections).toEqual([]);
  });
});

describe("validateValeRuleConfig rejects", () => {
  it("a run-level key above the first matcher, naming the key and line", () => {
    const result = verdict("root-keys");
    expect(ids(result)).toEqual([
      "vale-config-no-root-keys",
      "vale-config-no-root-keys",
    ]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 1: "StylesPath" is assigned above the first [matcher]. ' +
        "Vale reads it as a run-level setting and ignores a rule assignment there (W101). " +
        "StylesPath and MinAlertLevel are set by the assembled run config; a rule assignment belongs inside a matcher."
    );
    expect(result.rejections[1]?.message).toMatch(
      /line 2: "MinAlertLevel" is assigned above/
    );
  });

  it("a rule assignment with no matcher at all, on both counts", () => {
    // The W101 case that motivated the schema: Vale exits zero, finds nothing,
    // and the rule is enabled nowhere.
    const result = verdict("root-assignment-only");
    expect(ids(result)).toEqual([
      "vale-config-no-root-keys",
      "vale-config-matcher-required",
    ]);
    expect(result.rejections[1]?.message).toBe(
      "no-simply/.vale.ini declares no matcher, so the rule is scoped to nothing and will never run."
    );
  });

  it("a matcher with no breadcrumb, naming the matcher", () => {
    const result = verdict("no-breadcrumb");
    expect(ids(result)).toEqual(["vale-config-breadcrumb-required"]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 1: matcher [*.md] has no "tskl) rule = no-simply" breadcrumb, ' +
        "so nothing attributes it to no-simply once every rule's config is assembled into one file."
    );
  });

  it("a breadcrumb naming another rule", () => {
    const result = verdict("wrong-breadcrumb");
    expect(ids(result)).toEqual(["vale-config-breadcrumb-required"]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 2: matcher [*.md] carries "tskl) rule = no-hedging", ' +
        "but this is no-simply's config. The breadcrumb names the rule whose config it is in."
    );
  });

  it("a key naming another rule, as a cross-rule override", () => {
    const result = verdict("foreign-key");
    expect(ids(result)).toEqual(["vale-config-own-key-only"]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 4: matcher [*.md] assigns "no-hedging.no-hedging", which names another rule. ' +
        "A rule's config may only enable or disable itself, as no-simply.no-simply; anything else is a cross-rule override."
    );
  });

  it("a run-level key inside a matcher", () => {
    const result = verdict("stray-key");
    expect(ids(result)).toEqual(["vale-config-own-key-only"]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 3: matcher [*.md] assigns "MinAlertLevel", which is not a per-rule setting. ' +
        'Inside a matcher a rule\'s config carries only "tskl) rule" and no-simply.no-simply.'
    );
  });

  it("a value other than YES or NO, and does not count it as an enable", () => {
    // Measured against the pinned binary: `yes` leaves the rule off, and a
    // level name turns it on at that level. Neither is what a scope says.
    const result = verdict("bad-value");
    expect(ids(result)).toEqual([
      "vale-config-value-yes-no",
      "vale-config-enabled-somewhere",
    ]);
    expect(result.rejections[0]?.message).toMatch(
      /^no-simply\/\.vale\.ini line 3: no-simply\.no-simply = "yes" is not YES or NO\. Vale [\d.]+ reads a level name here/
    );
  });

  it("an empty BasedOnStyles", () => {
    // Rejected since Vale 3.22.0, where it was inert before. Measured on
    // that binary: an empty `BasedOnStyles` in a later matcher clears every
    // setting the file inherited from an earlier one, and the assembled run
    // config is every rule's matchers in id order, so the line silences the
    // other rules under whatever the matcher reaches. Only a byte-identical
    // glob, which Vale merges into one section, escapes. Pinned in
    // `vale-vendor-contract.test.ts`; migration 0008 deletes the line.
    const result = verdict("based-on-styles");
    expect(ids(result)).toEqual(["vale-config-no-based-on-styles"]);
    expect(result.rejections[0]?.message).toBe(
      "no-simply/.vale.ini line 3: matcher [*.md] sets BasedOnStyles to empty. " +
        `On Vale ${VALE_VERSION} an empty BasedOnStyles clears every earlier matcher's settings for a file this one reaches, ` +
        "which silences the other rules whose globs overlap. Delete the line: no bundled style loads unless a run-level BasedOnStyles names one."
    );
  });

  it("a [formats] section, as a matcher it cannot be", () => {
    // Vale 3.22.0 lets a `[formats]` key be a file name or a glob, which
    // moves a file between parser tiers. The schema has no notion of the
    // section: it is a matcher named `formats` with no breadcrumb and a
    // foreign key, so it is refused on both counts and the tier table's
    // extension-decides-the-parser claim stays true of every assembled run.
    const result = validateValeRuleConfig(
      RULE,
      "[formats]\nNOTES = md\n\n[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    expect(ids(result)).toEqual([
      "vale-config-breadcrumb-required",
      "vale-config-own-key-only",
    ]);
    expect(result.rejections[1]?.message).toMatch(
      /line 2: matcher \[formats\] assigns "NOTES", which is not a per-rule setting/
    );
  });

  it("a BasedOnStyles naming a style", () => {
    const result = verdict("based-on-styles-named");
    expect(ids(result)).toEqual(["vale-config-no-based-on-styles"]);
    expect(result.rejections[0]?.message).toBe(
      'no-simply/.vale.ini line 3: matcher [*.md] sets BasedOnStyles = "Vale". ' +
        "A bundled style loaded here fires alongside no-simply and reaches every rule whose matchers overlap. Delete the line: a rule enables itself by name."
    );
  });

  it("a file with no matcher", () => {
    const result = verdict("no-matcher");
    expect(ids(result)).toEqual(["vale-config-matcher-required"]);
    expect(result.sections).toEqual([]);
  });

  it("a config that never enables the rule", () => {
    const result = verdict("never-enabled");
    expect(ids(result)).toEqual(["vale-config-enabled-somewhere"]);
    expect(result.rejections[0]?.message).toBe(
      "no-simply/.vale.ini never enables no-simply.no-simply, so the rule is present but off."
    );
  });

  it("a YES overridden by a later NO in the same matcher, as present but off", () => {
    // The verdict is the matcher's FINAL assignment (Vale keeps the last), so
    // the only YES here never reaches Vale. The repeat is still advised.
    const result = verdict("repeat-key");
    expect(ids(result)).toEqual(["vale-config-enabled-somewhere"]);
    expect(result.rejections[0]?.message).toBe(
      "no-simply/.vale.ini enables no-simply.no-simply only where a later assignment to the same matcher turns it off again, so the rule is present but off."
    );
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatch(/assigns no-simply\.no-simply again/);
  });

  it("a YES overridden by a NO in a second section with the same glob", () => {
    // Vale merges same-glob sections before it reads them, so this is the
    // same override split across two headers.
    const result = verdict("repeat-across-sections");
    expect(ids(result)).toEqual(["vale-config-enabled-somewhere"]);
    expect(result.rejections[0]?.message).toMatch(
      /enables no-simply\.no-simply only where a later assignment to the same matcher turns it off again/
    );
    expect(result.sections).toEqual(["*.md", "*.md"]);
  });

  it("judges the ordering by folded verdicts, not by any single assignment", () => {
    // [docs/legacy/**] reads YES then NO, so its verdict is NO, and it sits
    // before the only YES-verdict matcher: the same rejection as a plain NO.
    const result = validateValeRuleConfig(
      RULE,
      "[docs/legacy/**]\ntskl) rule = no-simply\nno-simply.no-simply = YES\nno-simply.no-simply = NO\n\n" +
        "[docs/**]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    expect(ids(result)).toEqual(["vale-config-disable-after-enable"]);
    expect(result.rejections[0]?.message).toMatch(
      /line 1: matcher \[docs\/legacy\/\*\*\] disables no-simply before any matcher enables it, and \[docs\/\*\*\] line 6/
    );
  });

  it("a NO before every YES, naming both matchers", () => {
    const result = verdict("no-before-yes");
    expect(ids(result)).toEqual(["vale-config-disable-after-enable"]);
    expect(result.rejections[0]?.message).toBe(
      "no-simply/.vale.ini line 1: matcher [docs/legacy/**] disables no-simply before any matcher enables it, " +
        "and [docs/**] line 5 re-enables it afterwards, so this NO is either dead or overridden. " +
        "Precedence is positional: move the NO after the YES it narrows."
    );
  });

  it("is keyed by the rule id, so the same file fails under another id", () => {
    const result = verdict("valid", "no-hedging");
    expect(ids(result)).toEqual([
      "vale-config-breadcrumb-required",
      "vale-config-own-key-only",
      "vale-config-breadcrumb-required",
      "vale-config-own-key-only",
      "vale-config-enabled-somewhere",
    ]);
  });
});

describe("validateValeRuleConfig advises, without rejecting", () => {
  it("a key assigned twice inside one matcher, while a YES survives elsewhere", () => {
    const result = verdict("repeat-key-still-enabled");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toEqual([
      "no-simply/.vale.ini line 8: matcher [*.md] assigns no-simply.no-simply again (first line 7). " +
        `Vale ${VALE_VERSION} keeps the last assignment, "NO"; through 3.20.0 it kept the first.`,
    ]);
  });

  it("a key assigned once in each of two sections with the same glob", () => {
    // Vale merges duplicate `[glob]` sections, so this is the same repeat.
    const result = verdict("repeat-across-sections-still-enabled");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatch(
      /line 11: matcher \[\*\.md\] assigns no-simply\.no-simply again \(first line 7\)/
    );
    // Every header is still reported as a section: the AST is the file's.
    expect(result.sections).toEqual(["docs/**", "*.md", "*.md"]);
  });

  it("a [*] matcher", () => {
    const result = verdict("star");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toEqual([
      "no-simply/.vale.ini line 1: matcher [*] enables no-simply for every file Vale can read, code included. " +
        "Narrow it to the prose it is for (for example [*.md]) unless that is meant.",
    ]);
  });

  it("a .taskless/** matcher", () => {
    const result = verdict("taskless-tree");
    expect(result.rejections).toEqual([]);
    expect(result.advisories).toEqual([
      // The advisory names both halves deliberately. It said the matcher only
      // ever acted under a bare `vale`, which is wrong: `check` drops
      // `.taskless/` on a whole-project walk only, so the matcher does bite on
      // an explicitly named fixture bucket, and there it empties the one
      // command that shows a rendered message (taskless/cli#370).
      "no-simply/.vale.ini line 5: matcher [.taskless/**] is unnecessary on a whole-project check, " +
        "which excludes .taskless/ before Vale runs, " +
        "and it silences the rule on a path you name, such as its own fixture bucket.",
    ]);
  });
});
