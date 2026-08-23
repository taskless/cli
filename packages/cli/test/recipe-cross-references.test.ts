import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SUBCOMMAND_NAMES } from "../src/commands/names";
import { getRecipe } from "../src/prompts/recipes";
import { buildInvocation } from "../src/util/invocation";

/**
 * Recipes cite each other by topic name, in prose. Nothing resolves those
 * citations at build time — they are strings an agent reads and then types —
 * so a renamed topic leaves a reference that stays valid-looking and fails
 * only when an agent runs it and gets a non-zero exit and no recipe.
 *
 * That is the failure mode the `taskless help` → `taskless agent` rename
 * created 90 opportunities for.
 *
 * The citation checks read RENDERED recipes, not sources. A recipe names the
 * CLI as `%(TASKLESS_CLI)s`, and a pattern anchored on a package or binary
 * name — the thing that keeps prose ("the agent should…") from being read as a
 * citation — cannot see through a placeholder. Rendering first turns the
 * invocation into a literal the pattern can anchor on, and it is also the text
 * an agent is actually handed. The source is still the authority for the
 * checks that are about how recipes are *written*, which is why the guard
 * below reads it directly.
 */
const recipeDirectory = resolve(import.meta.dirname, "../src/agent");

function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * The CLI's subcommands, as a recipe would name one — read from the registry
 * in `src/commands/names.ts` rather than restated here. A restated list is a
 * blind spot with a delay on it: a subcommand added to the CLI but forgotten
 * here drops out of the alternation, and the guard below stops flagging a
 * hand-written `taskless <that-command>` without anything going red.
 */
const SUBCOMMANDS = SUBCOMMAND_NAMES.map((name) => escapeRegExp(name)).join(
  "|"
);

/**
 * Every spelling the CLI can carry in RENDERED recipe text, longest first so
 * the alternation prefers the most specific.
 *
 * `<taskless-cli>` is what a prod build with no detected launcher renders, and
 * `buildInvocation()` is whatever THIS build bakes in — `npx @taskless/cli` for
 * prod, `npx @taskless/cli-nightly@<version>` for a nightly, and a bare
 * `node <path>/index.js` for `dev`/`self`. That last one is why the list is
 * derived rather than written out: a fixed `taskless|@taskless/cli` anchor
 * matches nothing under `TASKLESS_BUILD_TARGET=self`, so every citation check
 * below would find zero citations and pass without checking anything. The two
 * bare legacy spellings stay in the list so a citation that regresses to one of
 * them is still checked rather than silently skipped.
 */
const CLI_NAMES = [
  escapeRegExp(buildInvocation()),
  "<taskless-cli>",
  "@taskless/cli",
  "taskless",
].join("|");

/**
 * A CLI invocation spelled out in a recipe source instead of deferred to
 * `%(TASKLESS_CLI)s`: a bare `taskless <cmd>` binary that is not on the
 * reader's PATH, or a hardcoded `npx @taskless/cli <cmd>` that pins the
 * released package into a nightly's own instructions.
 *
 * The lookbehind is what keeps `.taskless/rules/…` and `@taskless/cli` from
 * matching the bare form.
 */
const HARDCODED_INVOCATION = new RegExp(
  String.raw`npx @taskless/cli|(?<![\w@/.-])taskless (?=(?:` +
    SUBCOMMANDS +
    String.raw`)\b)`
);

/**
 * The two places a literal invocation is CORRECT, and why. Both are prose
 * *about* invocations rather than an instruction to run one, which is the
 * distinction the regex cannot draw on its own.
 *
 * Kept as content matches rather than line numbers so an edit above them does
 * not silently move the exemption onto a different line. If the prose changes
 * enough that a snippet stops matching, the staleness test below fails — which
 * is the intended outcome: a reworded exception deserves to be re-justified,
 * not silently carried forward.
 */
const ALLOWED_HARDCODED: { file: string; snippet: string; why: string }[] = [
  {
    file: "ci.txt",
    snippet: "`npx @taskless/cli`, `pnpm dlx @taskless/cli`,",
    why: "Enumerates what %(PACKAGE_MANAGER_DLX)s expands to. Naming the four complete invocations IS the documentation; substituting the variable here would define the placeholder in terms of itself.",
  },
  {
    file: "ci.txt",
    snippet: "`pnpm taskless check`",
    why: "That `taskless` is the binary pnpm resolves from the WIRED REPO's node_modules/.bin when @taskless/cli is their dev dependency — a foreign binary, not this CLI's invocation. %(TASKLESS_CLI)s would render `pnpm npx @taskless/cli check`.",
  },
];

function isAllowed(file: string, line: string): boolean {
  return ALLOWED_HARDCODED.some(
    (entry) => entry.file === file && line.includes(entry.snippet)
  );
}

async function recipeFiles(): Promise<string[]> {
  const entries = await readdir(recipeDirectory);
  return entries.filter((entry) => entry.endsWith(".txt")).toSorted();
}

/** Topic names that resolve, i.e. `<topic>.txt` exists in the recipe directory. */
async function embeddedTopics(): Promise<Set<string>> {
  const files = await recipeFiles();
  return new Set(
    files
      .map((file) => file.replace(/\.txt$/, ""))
      .map((name) => name.replace(/\.anonymous$/, ""))
  );
}

/** Every shipped recipe as an agent receives it, keyed by its source file. */
async function renderedRecipes(): Promise<Array<[string, string]>> {
  const files = await recipeFiles();
  return files.map((file) => {
    const stem = file.replace(/\.txt$/, "");
    const anonymous = stem.endsWith(".anonymous");
    const topic = stem.replace(/\.anonymous$/, "");
    return [file, getRecipe(topic, { anonymous }) ?? ""];
  });
}

describe("shipped recipes name only commands that exist", () => {
  it("contains no reference to the former `taskless help` command", async () => {
    const offenders: string[] = [];
    for (const [file, rendered] of await renderedRecipes()) {
      for (const [index, line] of rendered.split("\n").entries()) {
        if (new RegExp(String.raw`(?:${CLI_NAMES}) help\b`).test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A topic that does not resolve is the expensive case: the agent has already
  // committed to a plan that routes through it before finding out.
  it("cites only topics that resolve to an embedded recipe", async () => {
    const topics = await embeddedTopics();
    const dangling: string[] = [];
    const citation = new RegExp(
      String.raw`(?:${CLI_NAMES}) agent ([a-z][a-z-]*)`,
      "g"
    );
    let cited = 0;

    for (const [file, rendered] of await renderedRecipes()) {
      for (const [index, line] of rendered.split("\n").entries()) {
        for (const match of line.matchAll(citation)) {
          const topic = match[1];
          if (topic === undefined) continue;
          cited += 1;
          if (!topics.has(topic)) {
            dangling.push(`${file}:${String(index + 1)} cites '${topic}'`);
          }
        }
      }
    }

    expect(dangling).toEqual([]);
    // An empty `dangling` is the same result whether every citation resolved or
    // the pattern matched none of them, and the second reads as a pass. Recipes
    // cross-reference each other heavily, so a run that finds no citation at
    // all has stopped measuring the thing it reports on.
    expect(cited, "found no recipe cross-references to check").toBeGreaterThan(
      10
    );
  });

  // Every recipe is reachable by the name its filename implies. A header that
  // disagrees with the filename means `taskless agent <name>` prints a recipe
  // announcing itself as something else.
  it("opens each recipe with a header naming its own topic", async () => {
    const mismatched: string[] = [];
    for (const file of await recipeFiles()) {
      const source = await readFile(join(recipeDirectory, file), "utf8");
      const topic = file.replace(/(\.anonymous)?\.txt$/, "");
      const firstLine = source.split("\n")[0] ?? "";
      if (!firstLine.startsWith(`# Topic: ${topic}`)) {
        mismatched.push(`${file}: ${firstLine}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe("recipes defer the CLI invocation to the renderer", () => {
  /**
   * The regression guard for the normalization. Read over SOURCE, because the
   * failure it prevents is an author writing the invocation out by hand — and
   * a hardcoded `npx @taskless/cli` is invisible after rendering under a prod
   * build, where it is exactly what a correct `%(TASKLESS_CLI)s` would have
   * produced. Only the source distinguishes the two.
   */
  it("spells no CLI invocation by hand in any recipe source", async () => {
    const offenders: string[] = [];
    for (const file of await recipeFiles()) {
      const source = await readFile(join(recipeDirectory, file), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (HARDCODED_INVOCATION.test(line) && !isAllowed(file, line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
      }
    }
    // `taskless check` in a recipe sends a reader to a binary they almost
    // certainly do not have on PATH; `npx @taskless/cli check` in a nightly
    // sends them to the released package. Both are `%(TASKLESS_CLI)s check`.
    expect(offenders).toEqual([]);
  });

  // An allowlist nobody rechecks is how a guard quietly stops guarding. Each
  // entry must still match a line the regex would otherwise flag: if the prose
  // was reworded, or the exception removed, the entry is dead and the reason
  // attached to it no longer describes anything.
  it("carries no stale entry in the hardcoded-invocation allowlist", async () => {
    const stale: string[] = [];
    for (const entry of ALLOWED_HARDCODED) {
      const source = await readFile(join(recipeDirectory, entry.file), "utf8");
      const stillNeeded = source
        .split("\n")
        .some(
          (line) =>
            line.includes(entry.snippet) && HARDCODED_INVOCATION.test(line)
        );
      if (!stillNeeded) {
        stale.push(`${entry.file}: "${entry.snippet}" no longer matches`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("renders a real invocation into every recipe that names the CLI", async () => {
    const rendered = await renderedRecipes();
    // Same build-target reasoning as CLI_NAMES: a prod build with no detected
    // launcher renders the `<taskless-cli>` marker, every other target renders
    // its own invocation, and hardcoding the marker would make this assert
    // nothing under `dev`/`self`.
    const naming = rendered.filter(
      ([, text]) =>
        text.includes("<taskless-cli>") || text.includes(buildInvocation())
    );
    // Nearly every recipe tells the reader to run something; if this drops to
    // a handful, the normalization has been undone rather than improved.
    expect(naming.length).toBeGreaterThan(15);

    for (const [file, text] of naming) {
      expect(text, `${file} leaked a placeholder`).not.toContain(
        "%(TASKLESS_CLI)s"
      );
    }
  });
});
