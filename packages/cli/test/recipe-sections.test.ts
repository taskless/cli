import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getRecipe,
  getServedRecipe,
  onDemandSections,
  type RecipeOptions,
} from "../src/prompts/recipes";
import {
  ON_DEMAND_MARKER,
  parseRecipeSource,
  renderOutline,
  renderSection,
  sectionLinks,
  sectionSlug,
  splitSections,
} from "../src/prompts/sections";
import { SURVEYED_TOPICS } from "../src/survey/constants";
import { builtCli } from "./support/built-cli";

/**
 * Agent recipes are served in parts so each fetch fits what an agent harness
 * shows of one tool call (taskless/cli#672). One harness measurably cut its
 * output at about 8.6k characters, and cut the MIDDLE, so a recipe over the
 * limit lost the reference a step depended on rather than its tail.
 *
 * The budget is bytes, which is never fewer than characters, so a text that
 * fits it fits a limit counted either way.
 */
const BUDGET_BYTES = 8 * 1024;

/**
 * The longest invocation a recipe realistically renders: a nightly pins its
 * own version into every command it names. Measuring with the short marker
 * would pass a recipe that only fits when the reader is on a release.
 */
const LONG_INVOCATION =
  "npx @taskless/cli-nightly@0.13.8-20261111123456xabcdef0";

/**
 * Sections allowed over the budget, each with the reason. Keep this list
 * empty where possible: an entry is a fetch a harness may still cut.
 *
 * `report`'s facts schema is one fenced `%(INPUT_SCHEMA)s`, rendered from the
 * Zod source at about 13KB (8.3KB even as compact JSON), so no split of the
 * recipe can bring it under. Fitting it needs the schema itself served in
 * parts, which is its own change (taskless/cli#672 follow-up).
 */
const OVER_BUDGET_SECTIONS = new Map<string, string>([
  ["report.md --section facts-schema", "one rendered JSON schema"],
]);

const recipeDirectory = resolve(import.meta.dirname, "../src/agent");

/** Every recipe file as the options that select it. */
async function recipeVariants(): Promise<
  Array<{ file: string; topic: string; options: RecipeOptions }>
> {
  const entries = await readdir(recipeDirectory);
  const files = entries.filter((file) => file.endsWith(".md")).toSorted();
  return files.map((file) => {
    const [topic, variant] = file.replace(/\.md$/, "").split(".") as [
      string,
      string?,
    ];
    const anonymous = variant === "anonymous";
    const tool = variant === undefined || anonymous ? undefined : variant;
    return {
      file,
      topic,
      options: { anonymous, tool, invocation: LONG_INVOCATION },
    };
  });
}

function served(
  topic: string,
  options: RecipeOptions,
  selection: Parameters<typeof getServedRecipe>[2]
): string {
  const result = getServedRecipe(
    topic,
    { ...options, directive: true },
    selection
  );
  if (result?.kind !== "text") {
    throw new Error(
      `${topic}: nothing served for ${JSON.stringify(selection)}`
    );
  }
  return result.text;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function fetch(name: string): string {
  return `cli agent t --section ${name}`;
}

describe("sections", () => {
  it("slugs a heading the way a link names it", () => {
    expect(sectionSlug("Quirks")).toBe("quirks");
    expect(sectionSlug("Migrating to 0.12.0")).toBe("migrating-to-0-12-0");
    expect(sectionSlug("`language:` and the parsers")).toBe(
      "language-and-the-parsers"
    );
  });

  it("lifts a marker out and records the section under it", () => {
    const parsed = parseRecipeSource(
      [
        "# Topic: t",
        "",
        "## Steps",
        "x",
        ON_DEMAND_MARKER,
        "## Quirks",
        "y",
      ].join("\n"),
      "t.md"
    );
    expect(parsed.content).not.toContain(ON_DEMAND_MARKER);
    expect([...parsed.onDemand]).toEqual(["quirks"]);
  });

  it("refuses a marker that is not directly above a section heading", () => {
    expect(() =>
      parseRecipeSource(
        ["## Steps", ON_DEMAND_MARKER, "", "## Quirks"].join("\n"),
        "t.md"
      )
    ).toThrow(/t\.md:2/);
    expect(() =>
      parseRecipeSource(
        ["## Steps", ON_DEMAND_MARKER, "### Deeper"].join("\n"),
        "t.md"
      )
    ).toThrow();
  });

  it("does not split at a heading inside a fenced example", () => {
    const split = splitSections(
      ["intro", "## One", "```", "## not a section", "```", "## Two"].join("\n")
    );
    expect(split.preamble).toBe("intro");
    expect(split.sections.map(({ name }) => name)).toEqual(["one", "two"]);
  });

  const text = [
    "# Topic: t",
    "",
    "rule",
    "",
    "## Steps",
    "Read [Quirks](#quirks) and [Steps](#steps).",
    "",
    "## Quirks",
    "detail",
  ].join("\n");

  it("leaves out an on-demand section and lists it", () => {
    const outline = renderOutline(
      splitSections(text),
      new Set(["quirks"]),
      fetch
    );
    expect(outline).not.toContain("detail");
    expect(outline).toContain("- `quirks`\n");
    expect(outline).toContain("`cli agent t --section <name>`");
    // A link to a section left out becomes its command; one to a section
    // printed here stays a link.
    expect(outline).toContain("Read section `quirks` and");
    expect(outline).toContain("[Steps](#steps)");
  });

  it("returns a recipe with nothing on demand unchanged", () => {
    expect(renderOutline(splitSections(text), new Set(), fetch)).toBe(text);
  });

  it("serves one section under the preamble", () => {
    const split = splitSections(text);
    const quirks = split.sections.find(({ name }) => name === "quirks")!;
    const section = renderSection(split, quirks, fetch, "cli agent t");
    expect(section.startsWith("# Topic: t\n\nrule\n\n## Quirks")).toBe(true);
    expect(section).not.toContain("## Steps");
    expect(section).toContain("`cli agent t`");
  });
});

describe("every topic fits one tool call", () => {
  it("keeps each topic's default output within the budget", async () => {
    const over: string[] = [];
    for (const { file, topic, options } of await recipeVariants()) {
      let text = served(topic, options, { kind: "outline" });
      // A surveyed topic may end with the feedback invite, which is part of
      // what the reader is handed in that one call.
      if (SURVEYED_TOPICS.has(topic)) {
        text += `\n\n${getRecipe("feedback-invite", { invocation: LONG_INVOCATION, header: false }) ?? ""}`;
      }
      if (bytes(text) > BUDGET_BYTES) {
        over.push(`${file}: ${String(bytes(text))} bytes`);
      }
    }
    expect(over).toEqual([]);
  });

  it("keeps every section within the budget on its own", async () => {
    const over: string[] = [];
    const exempted = new Set<string>();
    for (const { file, topic, options } of await recipeVariants()) {
      const full = served(topic, options, { kind: "full" });
      for (const { name } of splitSections(full).sections) {
        const text = served(topic, options, { kind: "section", name });
        const key = `${file} --section ${name}`;
        if (bytes(text) > BUDGET_BYTES) {
          if (OVER_BUDGET_SECTIONS.has(key)) exempted.add(key);
          else over.push(`${key}: ${String(bytes(text))} bytes`);
        }
      }
    }
    expect(over).toEqual([]);
    // An exemption that no longer applies is removed, not carried forward.
    expect([...OVER_BUDGET_SECTIONS.keys()].toSorted()).toEqual(
      [...exempted].toSorted()
    );
  });

  it("serves the whole recipe on request, as the prompts export renders it", async () => {
    for (const { topic, options } of await recipeVariants()) {
      expect(served(topic, options, { kind: "full" })).toBe(
        getRecipe(topic, { ...options, directive: true })
      );
    }
  });

  it("has sections on request in the recipes that were too long", () => {
    // The issue's own four. A budget test that passes because every recipe
    // shrank is fine; one that passes because the mechanism went unused is
    // not what this is measuring.
    for (const topic of [
      "create-vale-rule",
      "update",
      "create-sg-rule",
      "route",
    ]) {
      expect(onDemandSections(topic).length, topic).toBeGreaterThan(0);
    }
  });
});

describe("every cross-referenced section is reachable by name", () => {
  it("links only to sections of the same recipe", async () => {
    const dangling: string[] = [];
    let linked = 0;
    for (const { file, topic, options } of await recipeVariants()) {
      const source = await readFile(join(recipeDirectory, file), "utf8");
      const names = new Set(
        splitSections(served(topic, options, { kind: "full" })).sections.map(
          ({ name }) => name
        )
      );
      for (const name of sectionLinks(source)) {
        linked += 1;
        if (!names.has(name)) dangling.push(`${file} links #${name}`);
      }
    }
    expect(dangling).toEqual([]);
    // An empty `dangling` also results from a pattern that matches nothing.
    expect(linked, "found no section links to check").toBeGreaterThan(10);
  });

  it("names only sections that exist when it cites another topic's", async () => {
    // `agent <topic> [flags] --section <name>`, as a recipe spells a fetch of
    // a section of another topic, or as the outline spells one of its own.
    const citation =
      /agent ([a-z][a-z-]*)((?: --[a-z]+(?:=[\w-]+)?)*) --section ([a-z\d-]+)/g;
    const dangling: string[] = [];
    let cited = 0;
    for (const { file, topic, options } of await recipeVariants()) {
      const texts = [served(topic, options, { kind: "outline" })];
      for (const name of onDemandSections(topic, options)) {
        texts.push(served(topic, options, { kind: "section", name }));
      }
      for (const text of texts) {
        for (const match of text.matchAll(citation)) {
          const [, citedTopic = "", flags = "", name = ""] = match;
          cited += 1;
          const tool = /--tool=([\w-]+)/.exec(flags)?.[1];
          const result = getServedRecipe(
            citedTopic,
            { tool, anonymous: flags.includes("--anonymous") },
            { kind: "section", name }
          );
          if (result?.kind !== "text") {
            dangling.push(`${file} cites ${citedTopic} --section ${name}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);
    expect(cited, "found no section citations to check").toBeGreaterThan(0);
  });
});

describe("taskless agent --section", () => {
  const execFileAsync = promisify(execFile);
  const binPath = builtCli();
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-section-"));
  });
  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    try {
      const { stdout, stderr } = await execFileAsync("node", [
        binPath,
        "agent",
        ...args,
        "-d",
        cwd,
      ]);
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const failed = error as { stdout: string; stderr: string; code: number };
      return {
        stdout: failed.stdout,
        stderr: failed.stderr,
        exitCode: failed.code,
      };
    }
  }

  it("prints a topic's outline by default", async () => {
    const result = await run(["create-sg-rule"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("## Sections on request");
    expect(result.stdout).toContain("- `quirks`");
  });

  it("prints one section", async () => {
    const result = await run(["create-sg-rule", "--section", "quirks"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Topic: create-sg-rule");
    expect(result.stdout).toContain("## Quirks");
    expect(result.stdout).not.toContain("## Steps");
  });

  it("refuses a section the topic does not have, and lists the ones it does", async () => {
    const result = await run(["create-sg-rule", "--section", "nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown section for create-sg-rule: nope");
    expect(result.stderr).toContain("quirks");
  });

  it("still refuses a second positional, and points at --section", async () => {
    const result = await run(["create-sg-rule", "quirks"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--section <name>");
  });
});
