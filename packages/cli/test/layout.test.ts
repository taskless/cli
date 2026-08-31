import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENGINES,
  RULES_DIRECTORY,
  RULE_TESTS_DIRECTORY,
  isKnownEngine,
} from "../src/layout/index.js";

const distributionDirectory = resolve(import.meta.dirname, "../dist");
const distributionLayoutPath = resolve(distributionDirectory, "layout.js");

/**
 * Import the BUILT entry, the way a consumer of `@taskless/cli/layout` does.
 *
 * The point is to exercise the artifact rather than the source: a published
 * entry that fails to load, or that loads something the source did not, is a
 * bug only the built file can show.
 */
async function importBuiltLayout(): Promise<Record<string, unknown>> {
  const url = pathToFileURL(distributionLayoutPath).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

/**
 * The exact public surface. Hand-maintained on purpose.
 *
 * An exported name is a promise held for a major version, and this entry
 * re-exports from a module the CLI also uses internally — so a helper added
 * there for internal reasons would otherwise become public API by being in the
 * same file as the data. This list is the gate: widening it is a deliberate
 * edit, not a side effect.
 */
const PUBLIC_EXPORTS = [
  "ENGINES",
  "ENGINE_LAYOUTS",
  "RULES_DIRECTORY",
  "RULE_TESTS_DIRECTORY",
  "isKnownEngine",
] as const;

describe("the published layout entry", () => {
  it("exports exactly the promised surface", async () => {
    const built = await importBuiltLayout();
    expect(Object.keys(built).toSorted()).toEqual(
      [...PUBLIC_EXPORTS].toSorted()
    );
  });

  it("carries the same values the CLI dispatches on", async () => {
    // Not a copy kept in step — the same module. If these ever differ, a
    // consumer is building against a layout the CLI does not use.
    const built = await importBuiltLayout();
    expect(built.ENGINES).toEqual(ENGINES);
    expect(built.RULES_DIRECTORY).toBe(RULES_DIRECTORY);
    expect(built.RULE_TESTS_DIRECTORY).toBe(RULE_TESTS_DIRECTORY);
    expect(Object.keys(built.ENGINE_LAYOUTS as object).toSorted()).toEqual(
      [...ENGINES].toSorted()
    );
  });

  it("describes every engine it declares", async () => {
    // `satisfies Record<EngineName, EngineLayout>` enforces this at compile
    // time for us. A consumer reads the shipped JavaScript, where that
    // guarantee is gone, so it is worth one runtime assertion.
    const built = await importBuiltLayout();
    const layouts = built.ENGINE_LAYOUTS as Record<
      string,
      { engine: string; ruleFile: (id: string) => string }
    >;
    for (const engine of built.ENGINES as string[]) {
      const layout = layouts[engine];
      expect(layout, `${engine} has a layout`).toBeDefined();
      expect(layout?.engine).toBe(engine);
      expect(typeof layout?.ruleFile("some-rule-abc12345")).toBe("string");
    }
  });

  it("names the rule file each engine actually uses", async () => {
    const built = await importBuiltLayout();
    const layouts = built.ENGINE_LAYOUTS as Record<
      string,
      {
        ruleFile: (id: string) => string;
        ruleConfigFile: string | undefined;
        capturesDirectory: string | undefined;
      }
    >;
    // The three facts a payload builder needs, asserted through the built
    // artifact because that is what it will read.
    expect(layouts.sg?.ruleFile("no-eval-abc12345")).toBe(
      "no-eval-abc12345.yml"
    );
    expect(layouts.vale?.ruleConfigFile).toBe(".vale.ini");
    expect(layouts.runtime?.ruleFile("anything")).toBe("check.ts");
    expect(layouts.runtime?.capturesDirectory).toBe("captures");
  });

  it("recognizes its own engines and nothing else", async () => {
    const built = await importBuiltLayout();
    const known = built.isKnownEngine as (value: string) => boolean;
    for (const engine of built.ENGINES as string[]) {
      expect(known(engine), engine).toBe(true);
    }
    expect(known("eslint")).toBe(false);
    expect(known("")).toBe(false);
  });

  it("is typed for consumers", async () => {
    await expect(
      readFile(resolve(distributionDirectory, "layout/index.d.ts"), "utf8")
    ).resolves.toContain("ENGINE_LAYOUTS");
  });

  it("is a library module, not an executable script", async () => {
    const source = await readFile(distributionLayoutPath, "utf8");
    expect(source.startsWith("#!")).toBe(false);
  });

  it("matches isKnownEngine in source", () => {
    expect(isKnownEngine("sg")).toBe(true);
    expect(isKnownEngine("nope")).toBe(false);
  });
});
