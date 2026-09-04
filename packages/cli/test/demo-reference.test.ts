import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSignature } from "../src/rules/rule-hash";
import {
  buildDemoReference,
  type DemoReference,
} from "../src/rules/demo/reference";
import { DEMO_MANIFESTS, writtenPaths } from "../src/rules/demo/manifest";
import { DEMO_RULES } from "../src/rules/demo/rule";

/**
 * The reference payload other teams consume, and the rules we ship, describe
 * the same thing.
 *
 * Two lists exist because `?raw` only resolves under a vite transform, so the
 * generator script reads the assets off disk while the bundle embeds them.
 * Nothing stops those from drifting except this file.
 */

const referencePath = join(
  import.meta.dirname,
  "..",
  "assets",
  "demo-reference.json"
);

async function readReference(): Promise<DemoReference> {
  return JSON.parse(await readFile(referencePath, "utf8")) as DemoReference;
}

function ruleFor(reference: DemoReference, engine: string) {
  const rule = reference.rules.find((entry) => entry.engine === engine);
  if (rule === undefined) throw new Error(`reference has no ${engine} rule`);
  return rule;
}

describe("the demo reference payload", () => {
  it("is current — regenerate with `pnpm --filter @taskless/cli demo:reference`", async () => {
    expect(await readReference()).toEqual(buildDemoReference(DEMO_RULES));
  });

  it("embeds exactly the files each manifest lists", () => {
    for (const manifest of DEMO_MANIFESTS) {
      const rule = DEMO_RULES.find((entry) => entry.engine === manifest.engine);
      expect(rule?.ruleFiles.map((file) => file.path)).toEqual([
        ...manifest.rulePaths,
      ]);
      expect(rule?.testFiles.map((file) => file.path)).toEqual([
        ...manifest.testPaths,
      ]);
    }
  });

  it("names every dot-path explicitly, because a glob would drop them", () => {
    // The regression this replaces was specific: a switch to glob-based path
    // discovery embeds the rule file and silently omits every dot-path case,
    // producing a rule that writes, verifies, and has nothing to prove. The
    // test that caught it asserted particular paths, so this one does too --
    // iterating whatever the manifest happens to hold would pass trivially
    // over a shrunken list, which is exactly the failure being guarded.
    const required: Record<string, readonly string[]> = {
      sg: [".tests/no-eval-call-test.yml"],
      vale: [".vale.ini", ".tests/pass/README.md", ".tests/fail/README.md"],
      runtime: [".tests/pass/declared/.env", ".tests/fail/undeclared/.env"],
    };

    // A fourth sample has to be added here as well as to the manifest. That is
    // the point: whoever adds it states which of its files are dot-paths,
    // rather than inheriting a guard that silently covers nothing.
    expect(
      DEMO_MANIFESTS.map((manifest) => manifest.engine).toSorted()
    ).toEqual(Object.keys(required).toSorted());

    for (const manifest of DEMO_MANIFESTS) {
      const written = writtenPaths(manifest);
      for (const path of required[manifest.engine] ?? []) {
        expect(written, `${manifest.engine} no longer lists ${path}`).toContain(
          path
        );
      }
    }
  });

  it("carries one rule per engine", async () => {
    const reference = await readReference();
    const engines = reference.rules.map((rule) => rule.engine);
    expect(engines.toSorted()).toEqual(["runtime", "sg", "vale"]);
  });

  it("signs only the runtime rule, because only it is gated", async () => {
    const reference = await readReference();

    // Well-formed on purpose. A malformed signature would be refused by the
    // parser, which exercises the wrong half of the gate — the half worth
    // demonstrating is the COMPARISON, which a parseable-but-wrong value
    // reaches.
    const parsed = parseSignature(
      ruleFor(reference, "runtime").signature ?? ""
    );
    expect(parsed.algoVersion).toBe(1);
    expect(parsed.algo).toBe("sha-256");
    // All zeros, so it can never be mistaken for a blessed signature or lifted
    // out of the file into something that would run.
    expect(parsed.digest).toBe("0".repeat(64));

    // `sg` and `vale` are inert data. A signature on them would imply a gate
    // that does not exist.
    expect(ruleFor(reference, "sg").signature).toBeUndefined();
    expect(ruleFor(reference, "vale").signature).toBeUndefined();
  });
});

describe("the reference payload is reachable by another team", () => {
  it("is a published export, not just a repository file", async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { files: string[]; exports: Record<string, unknown> };

    // Both halves are needed and neither implies the other: `exports` without
    // `files` names a path npm does not ship, and `files` without `exports` is
    // unreachable under this package's strict export map.
    expect(manifest.files).toContain("assets/demo-reference.json");
    expect(manifest.exports["./demo-reference.json"]).toBe(
      "./assets/demo-reference.json"
    );
  });
});
