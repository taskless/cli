import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Recipes cite each other by topic name, in prose. Nothing resolves those
 * citations at build time — they are strings an agent reads and then types —
 * so a renamed topic leaves a reference that stays valid-looking and fails
 * only when an agent runs it and gets a non-zero exit and no recipe.
 *
 * That is the failure mode the `taskless help` → `taskless agent` rename
 * created 90 opportunities for. These read the recipe sources, which are the
 * authority for what ships, rather than a built bundle: the bundler resolves
 * imports, and a prose cross-reference is not one, so there is no structured
 * answer to ask it for.
 */
const recipeDirectory = resolve(import.meta.dirname, "../src/agent");

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

describe("shipped recipes name only commands that exist", () => {
  it("contains no reference to the former `taskless help` command", async () => {
    const offenders: string[] = [];
    for (const file of await recipeFiles()) {
      const source = await readFile(join(recipeDirectory, file), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (line.includes("taskless help")) {
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

    for (const file of await recipeFiles()) {
      const source = await readFile(join(recipeDirectory, file), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // `taskless agent <topic>`, however it is punctuated around.
        for (const match of line.matchAll(/taskless agent ([a-z][a-z-]*)/g)) {
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
