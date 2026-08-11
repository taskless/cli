import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  PROMPTS,
  TOPICS,
  INTERNAL_TOPICS,
  getPrompt,
  type PromptOptions,
} from "../src/prompts/index";
import { canonicalRecipeTopics, getRecipe } from "../src/prompts/recipes";

const execFileAsync = promisify(execFile);

const helpDirectory = resolve(import.meta.dirname, "../src/help");
const distributionDirectory = resolve(import.meta.dirname, "../dist");
const binPath = resolve(distributionDirectory, "index.js");
const distributionPromptsPath = resolve(distributionDirectory, "prompts.js");

/** A `%(KEY)s` placeholder that survived rendering. */
const UNRESOLVED_PLACEHOLDER = /%\([A-Z_]+\)s/;

/**
 * Import the built prompts entry the way a consumer would. The specifier is a
 * runtime value so it stays a real ESM import of the artifact rather than
 * something the bundler or the type-checker resolves back to source.
 */
async function importBuiltPrompts(): Promise<{
  getPrompt: (topic: "static", options?: PromptOptions) => string;
  TOPICS: readonly string[];
}> {
  const url = pathToFileURL(distributionPromptsPath).href;
  return (await import(/* @vite-ignore */ url)) as {
    getPrompt: (topic: "static", options?: PromptOptions) => string;
    TOPICS: readonly string[];
  };
}

/** Canonical `<topic>.txt` names on disk, excluding `.anonymous` variants. */
async function canonicalTopicsOnDisk(): Promise<string[]> {
  const entries = await readdir(helpDirectory);
  return entries
    .filter((name) => name.endsWith(".txt"))
    .map((name) => name.slice(0, -".txt".length))
    .filter((stem) => !stem.endsWith(".anonymous"))
    .toSorted();
}

describe("prompt rendering", () => {
  it("resolves every placeholder in every canonical recipe", async () => {
    for (const topic of await canonicalTopicsOnDisk()) {
      const rendered = getRecipe(topic);
      expect(rendered, `no recipe embedded for ${topic}`).toBeDefined();
      expect(rendered, `unresolved placeholder in ${topic}`).not.toMatch(
        UNRESOLVED_PLACEHOLDER
      );
    }
  });

  it("renders the CLI version into the header", () => {
    expect(getPrompt("static")).toContain(`CLI v${__VERSION__}`);
  });

  it.each([
    ["rule-create", "prompt"],
    ["rule-improve", "ruleId"],
  ])("renders the JSON Schema for %s", (topic, property) => {
    const rendered = getRecipe(topic) ?? "";
    expect(rendered, `${topic} lost its schema`).not.toContain(
      "(no input schema for this topic)"
    );
    // The rendered schema is JSON, so its keys survive verbatim.
    expect(rendered, `${topic} schema not rendered`).toContain('"$schema"');
    expect(rendered).toContain(`"${property}"`);
  });

  it("renders the package-manager marker by default and honors an override", () => {
    const withDefault = getRecipe("ci") ?? "";
    expect(withDefault).toContain("<package-manager-dlx>");

    const withOverride =
      getRecipe("ci", { packageManagerDlx: "pnpm dlx" }) ?? "";
    expect(withOverride).toContain("pnpm dlx");
    expect(withOverride).not.toContain("<package-manager-dlx>");
  });

  it("returns undefined for an unknown topic", () => {
    expect(getRecipe("no-such-topic")).toBeUndefined();
  });
});

describe("header suppression", () => {
  it("drops the header line and the blank line after it, leaving the body intact", () => {
    const withHeader = getPrompt("static");
    const withoutHeader = getPrompt("static", { header: false });

    expect(withHeader.startsWith("# Topic: static")).toBe(true);
    expect(withoutHeader.startsWith("# Topic:")).toBe(false);
    // The body is the same string, minus the header line and its blank line.
    expect(withoutHeader).toBe(withHeader.split("\n").slice(2).join("\n"));
  });

  it("leaves no CLI version string behind", () => {
    for (const topic of TOPICS) {
      const withoutHeader = getPrompt(topic, { header: false });
      expect(withoutHeader, `${topic} kept the version`).not.toContain(
        __VERSION__
      );
      expect(withoutHeader, `${topic} kept a version header`).not.toMatch(
        /CLI v\d/
      );
    }
  });

  it("keeps the header by default", () => {
    expect(getPrompt("static")).toBe(getPrompt("static", { header: true }));
    expect(getPrompt("static")).toBe(getPrompt("static", {}));
  });
});

describe("anonymous variants", () => {
  it("returns the variant text for a topic that has one", () => {
    const canonical = getRecipe("rule-create");
    const anonymous = getRecipe("rule-create", { anonymous: true });
    expect(anonymous).toBeDefined();
    expect(anonymous).not.toBe(canonical);
    expect(anonymous).toContain("(anonymous)");
  });

  it("falls back to the canonical recipe for a topic without one", () => {
    expect(getRecipe("static", { anonymous: true })).toBe(getRecipe("static"));
  });
});

describe("typed accessor", () => {
  it("exposes a render function per exported topic", () => {
    expect(Object.keys(PROMPTS).toSorted()).toEqual(TOPICS.toSorted());
    for (const topic of TOPICS) {
      expect(PROMPTS[topic]()).toBe(getPrompt(topic));
    }
  });

  it("passes options through the map", () => {
    expect(PROMPTS.static({ header: false })).toBe(
      getPrompt("static", { header: false })
    );
  });

  it("rejects an unknown topic at compile time", () => {
    // @ts-expect-error "nope" is not a member of PromptTopic
    expect(() => getPrompt("nope")).toThrow();
  });
});

describe("help command parity", () => {
  it.each([...TOPICS])(
    "matches `taskless help %s` byte for byte",
    async (topic) => {
      const { stdout } = await execFileAsync("node", [binPath, "help", topic]);
      // The command trims trailing whitespace before printing; console.log then
      // adds the single newline that stdout carries.
      expect(stdout.trimEnd()).toBe(getPrompt(topic).trimEnd());
    }
  );
});

describe("topic membership", () => {
  it("classifies every canonical recipe as exported or internal", async () => {
    const onDisk = await canonicalTopicsOnDisk();
    const classified = [...TOPICS, ...INTERNAL_TOPICS].toSorted();

    // Fails in both directions: an unclassified new recipe, and an exported or
    // internal topic whose recipe file is gone.
    expect(classified).toEqual(onDisk);
    // The embed must agree with the disk too, so a stale glob cannot hide a
    // divergence the check is meant to catch.
    expect(canonicalRecipeTopics().toSorted()).toEqual(onDisk);
  });

  it("keeps the two lists disjoint", () => {
    const overlap = TOPICS.filter((topic) =>
      (INTERNAL_TOPICS as readonly string[]).includes(topic)
    );
    expect(overlap).toEqual([]);
  });
});

describe("built prompts entry", () => {
  it("emits the entry and its declarations", async () => {
    await expect(
      readFile(distributionPromptsPath, "utf8")
    ).resolves.toBeTruthy();
    await expect(
      readFile(resolve(distributionDirectory, "prompts/index.d.ts"), "utf8")
    ).resolves.toContain("getPrompt");
  });

  it("leaves the CLI entry untyped", async () => {
    // The `.` export has no `types` condition. A `dist/index.d.ts` emitted
    // beside `dist/index.js` would hand consumers a typed CLI surface the
    // package never promised, as a side effect of typing the prompts entry —
    // which is the whole reason `tsconfig.prompts.json` scopes its include list.
    await expect(
      readFile(resolve(distributionDirectory, "index.d.ts"), "utf8")
    ).rejects.toThrow(/ENOENT/);
  });

  it("is a library module, not an executable script", async () => {
    const source = await readFile(distributionPromptsPath, "utf8");
    // The shebang plugin serves the `bin` entry. A `#!` line here would be a
    // syntax error for anything that imports the module.
    expect(source.startsWith("#!")).toBe(false);
    const bin = await readFile(binPath, "utf8");
    expect(bin.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("inlines every build define", async () => {
    const { getPrompt: getBuiltPrompt } = await importBuiltPrompts();
    const rendered = getBuiltPrompt("static");
    expect(rendered).toContain(`CLI v${__VERSION__}`);
    expect(rendered).not.toMatch(/__[A-Z_]+__/);
    expect(rendered).not.toMatch(UNRESOLVED_PLACEHOLDER);
  });

  it("renders identically from the built artifact and from source", async () => {
    const { getPrompt: getBuiltPrompt } = await importBuiltPrompts();
    expect(getBuiltPrompt("static")).toBe(getPrompt("static"));
    expect(getBuiltPrompt("static", { header: false })).toBe(
      getPrompt("static", { header: false })
    );
  });
});

/**
 * Whether `value` could be a module specifier at all.
 *
 * The scan below is a regex over the whole chunk, and a built chunk embeds
 * every recipe as a string literal — so ordinary prose containing the words
 * `from "…"` is matched as an import. That is not hypothetical: the
 * engine-selection recipe contains `a different axis from "which engine"`, and
 * it failed this guard with `dist/prompts.js graph imports which engine`.
 *
 * A real specifier is a bare name, a scope, a path, or a `node:` builtin —
 * never whitespace-bearing and never arbitrary punctuation. Filtering on that
 * shape drops prose without weakening the check, because anything the bundle
 * genuinely imports still matches.
 */
function looksLikeSpecifier(value: string): boolean {
  return /^(?:node:)?[@\w./-]+$/.test(value);
}

/** Module specifiers a built chunk imports, static and dynamic. */
function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    specifiers.add(match[1]!);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) {
    specifiers.add(match[1]!);
  }
  for (const match of source.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    specifiers.add(match[1]!);
  }
  return [...specifiers].filter((specifier) => looksLikeSpecifier(specifier));
}

describe("prompts entry carries no CLI runtime", () => {
  // Everything the render path is allowed to reach: embedded text, the two leaf
  // Zod schemas, the invocation rewrite, and the templating library.
  const ALLOWED_SOURCE_IMPORTS = new Set([
    "sprintf-js",
    "zod",
    "../util/invocation",
    "../schemas/rules-create",
    "../schemas/rules-improve",
    "./recipes.js",
  ]);

  it("imports nothing outside the allowlist at source level", async () => {
    for (const file of ["index.ts", "recipes.ts"]) {
      const source = await readFile(
        resolve(import.meta.dirname, "../src/prompts", file),
        "utf8"
      );
      for (const specifier of importSpecifiers(source)) {
        expect(
          ALLOWED_SOURCE_IMPORTS.has(specifier),
          `src/prompts/${file} imports ${specifier}`
        ).toBe(true);
      }
    }
  });

  it("never reaches the CLI entry or a host capability once built", async () => {
    const seen = new Set<string>();
    const queue = [distributionPromptsPath];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith(".")) {
          queue.push(resolve(dirname(file), specifier));
          continue;
        }
        // A bare specifier here would be an unbundled runtime dependency; the
        // lib build bundles everything except node builtins, so any survivor is
        // a builtin the prompts graph has no business touching.
        expect(specifier, `dist/prompts.js graph imports ${specifier}`).toBe(
          "<nothing>"
        );
      }
    }

    expect(
      [...seen].map((file) => file.replace(`${distributionDirectory}/`, ""))
    ).not.toContain("index.js");
  });
});
