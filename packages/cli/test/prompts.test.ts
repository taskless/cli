import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { sprintf } from "sprintf-js";
import { describe, expect, it } from "vitest";

import {
  PROMPTS,
  TOPICS,
  INTERNAL_TOPICS,
  getInstructions,
  getPrompt,
  getRawInstructions,
  type PromptOptions,
} from "../src/prompts/index";
import {
  buildVariables,
  canonicalRecipeTopics,
  getRawRecipe,
  getRecipe,
  getRenderedRecipe,
} from "../src/prompts/recipes";

const execFileAsync = promisify(execFile);

const recipeDirectory = resolve(import.meta.dirname, "../src/agent");
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
  getPrompt: (topic: "create-sg-rule", options?: PromptOptions) => string;
  TOPICS: readonly string[];
}> {
  const url = pathToFileURL(distributionPromptsPath).href;
  return (await import(/* @vite-ignore */ url)) as {
    getPrompt: (topic: "create-sg-rule", options?: PromptOptions) => string;
    TOPICS: readonly string[];
  };
}

/** Canonical `<topic>.txt` names on disk, excluding `.anonymous` variants. */
async function canonicalTopicsOnDisk(): Promise<string[]> {
  const entries = await readdir(recipeDirectory);
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
    expect(getPrompt("create-sg-rule")).toContain(`CLI v${__VERSION__}`);
  });

  it.each([
    ["create-remote-rule", "prompt"],
    ["improve-rule", "ruleId"],
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

/**
 * The `TASKLESS_CLI` value for a set of options. Resolution is asserted on the
 * variables table rather than on rendered recipe text: the table is where the
 * three-step decision is made, and its answer is the same whether or not any
 * given recipe happens to cite the CLI.
 */
function invocationVariable(options?: PromptOptions): string {
  return buildVariables("", "any-topic", options).TASKLESS_CLI!;
}

describe("the CLI invocation variable", () => {
  const TASKLESS_CLI = invocationVariable;

  it("renders the agent-fill marker from a prod build with no invocation", () => {
    // The test build is prod, so no build-target invocation is available and
    // nothing was passed in. The marker is the correct answer; `npx
    // @taskless/cli` would be a guess about a launcher the reader may not use.
    expect(TASKLESS_CLI()).toBe("<taskless-cli>");
    expect(TASKLESS_CLI({})).toBe("<taskless-cli>");
  });

  it("renders a supplied invocation verbatim", () => {
    expect(TASKLESS_CLI({ invocation: "pnpm dlx @taskless/cli@latest" })).toBe(
      "pnpm dlx @taskless/cli@latest"
    );
    expect(TASKLESS_CLI({ invocation: "node dist/index.js" })).toBe(
      "node dist/index.js"
    );
  });

  it("is provided on every render, alongside the other markers", () => {
    const table = buildVariables("", "any-topic");
    expect(Object.keys(table).toSorted()).toEqual([
      "AST_GREP_LANGUAGES",
      "AST_GREP_VERSION",
      "CLI_VERSION",
      "PACKAGE_MANAGER_DLX",
      "TASKLESS_CLI",
      "VALE_COMMENT_FORMATS",
      "VALE_CONVERTER_FORMATS",
      "VALE_MARKUP_FORMATS",
      "VALE_PLAINTEXT_FORMATS",
      "VALE_VERSION",
    ]);
    // INPUT_SCHEMA stays conditional on the placeholder being present.
    expect(buildVariables("%(INPUT_SCHEMA)s", "improve-rule")).toHaveProperty(
      "INPUT_SCHEMA"
    );
  });
});

describe("raw and rendered instructions", () => {
  it("round-trips: rendering the raw template reproduces the rendered text", async () => {
    for (const topic of await canonicalTopicsOnDisk()) {
      const raw = getRawRecipe(topic);
      const rendered = getRenderedRecipe(topic);
      expect(raw, `no raw recipe for ${topic}`).toBeDefined();
      expect(rendered, `no rendered recipe for ${topic}`).toBeDefined();
      expect(
        sprintf(raw!.text, buildVariables(raw!.text, topic)),
        `${topic} does not round-trip`
      ).toBe(rendered!.text);
    }
  });

  it("reports the same variables from both forms, and only real ones", async () => {
    for (const topic of await canonicalTopicsOnDisk()) {
      const raw = getRawRecipe(topic)!;
      expect(getRenderedRecipe(topic)!.variables.toSorted()).toEqual(
        raw.variables.toSorted()
      );
      // Every name sprintf asked for must be one the renderer can answer, or
      // the recipe carries a placeholder nothing resolves.
      const table = buildVariables(raw.text, topic);
      for (const name of raw.variables) {
        expect(table, `${topic} names an unresolvable ${name}`).toHaveProperty(
          name
        );
      }
    }
  });

  it("reports variables for the text it returns when the header is dropped", async () => {
    // The header line carries %(CLI_VERSION)s, so a header-less accessor must
    // not keep reporting a variable its own `text` no longer contains.
    const topics = await canonicalTopicsOnDisk();
    let droppedSomewhere = false;

    for (const topic of topics) {
      const raw = getRawRecipe(topic, { header: false })!;
      const rendered = getRenderedRecipe(topic, { header: false })!;

      expect(
        rendered.variables.toSorted(),
        `${topic} raw/rendered differ`
      ).toEqual(raw.variables.toSorted());
      for (const name of raw.variables) {
        expect(
          raw.text,
          `${topic} reports ${name} but the text has no placeholder for it`
        ).toContain(`%(${name})`);
      }

      const withHeader = getRawRecipe(topic)!.variables;
      expect(
        withHeader,
        `${topic} gained a variable by dropping the header`
      ).toEqual(expect.arrayContaining(raw.variables));
      if (
        withHeader.includes("CLI_VERSION") &&
        !raw.variables.includes("CLI_VERSION")
      ) {
        droppedSomewhere = true;
      }
    }

    expect(droppedSomewhere, "no recipe exercises a header-only variable").toBe(
      true
    );
  });

  it("keeps `%%` escaped in raw text and collapses it once rendered", async () => {
    // sprintf collapses `%%` to `%` irreversibly while parsing, which is why
    // the raw text must be the source template and never the output of the
    // variable-collecting pass.
    const topics = await canonicalTopicsOnDisk();
    const escaped = topics
      .map((topic) => ({ topic, raw: getRawRecipe(topic)!.text }))
      .filter(({ raw }) => raw.includes("%%"));

    expect(escaped.length, "no recipe exercises a `%%` escape").toBeGreaterThan(
      0
    );
    for (const { topic, raw } of escaped) {
      const rendered = getRecipe(topic) ?? "";
      expect(rendered, `${topic} kept its escape`).not.toContain("%%");
      expect(sprintf(raw, buildVariables(raw, topic))).toBe(rendered);
    }
  });

  it("exposes both forms as public API and matches getPrompt", () => {
    for (const topic of TOPICS) {
      expect(getInstructions(topic).text).toBe(getPrompt(topic));
      expect(getRawInstructions(topic).variables).toEqual(
        getInstructions(topic).variables
      );
      // Raw is a template, rendered is not.
      expect(getRawInstructions(topic).text).not.toBe(
        getInstructions(topic).text
      );
    }
  });

  it("throws on an unknown topic while getRecipe still returns undefined", () => {
    // @ts-expect-error "no-such-topic" is not a member of PromptTopic
    expect(() => getInstructions("no-such-topic")).toThrow(/packaging fault/);
    // @ts-expect-error "no-such-topic" is not a member of PromptTopic
    expect(() => getRawInstructions("no-such-topic")).toThrow(
      /packaging fault/
    );
    expect(getRawRecipe("no-such-topic")).toBeUndefined();
    expect(getRenderedRecipe("no-such-topic")).toBeUndefined();
  });
});

describe("header suppression", () => {
  it("drops the header line and the blank line after it, leaving the body intact", () => {
    const withHeader = getPrompt("create-sg-rule");
    const withoutHeader = getPrompt("create-sg-rule", { header: false });

    expect(withHeader.startsWith("# Topic: create-sg-rule")).toBe(true);
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
    expect(getPrompt("create-sg-rule")).toBe(
      getPrompt("create-sg-rule", { header: true })
    );
    expect(getPrompt("create-sg-rule")).toBe(getPrompt("create-sg-rule", {}));
  });
});

describe("anonymous variants", () => {
  it("returns the variant text for a topic that has one", () => {
    const canonical = getRecipe("improve-rule");
    const anonymous = getRecipe("improve-rule", { anonymous: true });
    expect(anonymous).toBeDefined();
    expect(anonymous).not.toBe(canonical);
    expect(anonymous).toContain("(anonymous)");
  });

  it("falls back to the canonical recipe for a topic without one", () => {
    expect(getRecipe("create-sg-rule", { anonymous: true })).toBe(
      getRecipe("create-sg-rule")
    );
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
    expect(PROMPTS["create-sg-rule"]({ header: false })).toBe(
      getPrompt("create-sg-rule", { header: false })
    );
  });

  it("rejects an unknown topic at compile time", () => {
    // @ts-expect-error "nope" is not a member of PromptTopic
    expect(() => getPrompt("nope")).toThrow();
  });
});

describe("agent command parity", () => {
  it.each([...TOPICS])(
    "matches `taskless agent %s` byte for byte",
    async (topic) => {
      const { stdout } = await execFileAsync("node", [binPath, "agent", topic]);
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
    const rendered = getBuiltPrompt("create-sg-rule");
    expect(rendered).toContain(`CLI v${__VERSION__}`);
    expect(rendered).not.toMatch(/__[A-Z_]+__/);
    expect(rendered).not.toMatch(UNRESOLVED_PLACEHOLDER);
  });

  it("renders identically from the built artifact and from source", async () => {
    const { getPrompt: getBuiltPrompt } = await importBuiltPrompts();
    expect(getBuiltPrompt("create-sg-rule")).toBe(getPrompt("create-sg-rule"));
    expect(getBuiltPrompt("create-sg-rule", { header: false })).toBe(
      getPrompt("create-sg-rule", { header: false })
    );
  });
});

/**
 * Module specifiers a **source** file imports, static and dynamic.
 *
 * Scoped to hand-written TypeScript on purpose. A regex is sound over a module
 * someone wrote and unsound over one a bundler generated: a built chunk embeds
 * every recipe as a string literal, so prose containing `from "…"` reads as an
 * import. The built graph is checked in the build instead — see
 * `assert-prompts-graph` in `vite.config.ts`, which reads rollup's resolved
 * `imports`/`dynamicImports` rather than guessing at them from text.
 */
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
  return [...specifiers];
}

describe("prompts entry carries no CLI runtime", () => {
  // Everything the render path is allowed to reach: embedded text, the two leaf
  // Zod schemas, the invocation rewrite, the engine capability constants, and
  // the templating library.
  //
  // `../rules/capabilities` earns its place by being pure data — the reach of
  // the pinned `sg` and Vale binaries, transcribed rather than probed at render
  // time. It sits under `src/rules/` beside its subject rather than in
  // `src/prompts/`, but it imports nothing at all, so it cannot drag the
  // command layer in behind it. The vendor-contract tests, which do spawn the
  // binaries, are what keep it honest; see taskless/cli#151.
  const ALLOWED_SOURCE_IMPORTS = new Set([
    "sprintf-js",
    "zod",
    "../util/invocation",
    "../rules/capabilities",
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

  // The built graph is NOT asserted here. `assert-prompts-graph` in
  // `vite.config.ts` fails the build if the prompts entry reaches the CLI entry
  // or imports anything external, so a bundle that leaks cannot be emitted in
  // the first place — there is no artifact left for a test to inspect. This
  // file keeps the source-level constraint, which is about what we wrote rather
  // than about what the build produced.
});
