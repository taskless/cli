import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getRecipe } from "../src/prompts/recipes";

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

/** The CLI's subcommands, as a recipe would name one. */
const SUBCOMMANDS =
  "agent|auth|check|detect|info|init|onboard|rule|test|update|verify";

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
        if (/(?:taskless|@taskless\/cli|<taskless-cli>) help\b/.test(line)) {
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

    for (const [file, rendered] of await renderedRecipes()) {
      for (const [index, line] of rendered.split("\n").entries()) {
        // `<taskless-cli> agent <topic>` is what the invocation renders to
        // under a prod build with no detected launcher, and it is the form
        // every recipe now uses. The two older spellings stay matched so a
        // citation that regresses to one of them is still checked rather than
        // silently skipped.
        for (const match of line.matchAll(
          /(?:taskless|@taskless\/cli|<taskless-cli>) agent ([a-z][a-z-]*)/g
        )) {
          const topic = match[1];
          if (topic !== undefined && !topics.has(topic)) {
            dangling.push(`${file}:${String(index + 1)} cites '${topic}'`);
          }
        }
      }
    }

    expect(dangling).toEqual([]);
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
        if (HARDCODED_INVOCATION.test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
      }
    }
    // `taskless check` in a recipe sends a reader to a binary they almost
    // certainly do not have on PATH; `npx @taskless/cli check` in a nightly
    // sends them to the released package. Both are `%(TASKLESS_CLI)s check`.
    expect(offenders).toEqual([]);
  });

  it("renders a real invocation into every recipe that names the CLI", async () => {
    const rendered = await renderedRecipes();
    const naming = rendered.filter(([, text]) =>
      text.includes("<taskless-cli>")
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
