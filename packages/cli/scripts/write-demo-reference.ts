/**
 * Regenerate `assets/reference.json` from the shipped rules.
 *
 * The corpus is every demonstration rule with the prompt it answers, the rule
 * itself, and the held-out cases — separately, so another team can run their
 * rule against our cases and ours against theirs.
 *
 * Reads the asset files directly rather than importing `rule.ts`, whose `?raw`
 * specifiers only resolve under a vite transform. Both read `DEMO_MANIFESTS`,
 * and `test/demo-reference.test.ts` asserts they agree.
 *
 * Run: pnpm --filter @taskless/cli demo:reference
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildDemoReference } from "../src/rules/demo/reference";
import { DEMO_MANIFESTS } from "../src/rules/demo/manifest";

const packageRoot = join(import.meta.dirname, "..");

async function readAll(assetDirectory: string, paths: readonly string[]) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(
        join(packageRoot, "assets", assetDirectory, path),
        "utf8"
      ),
    }))
  );
}

const rules = await Promise.all(
  DEMO_MANIFESTS.map(async (manifest) => ({
    engine: manifest.engine,
    ruleId: manifest.ruleId,
    prompt: await readFile(
      join(packageRoot, "assets", manifest.assetDirectory, manifest.promptPath),
      "utf8"
    ),
    ruleFiles: await readAll(manifest.assetDirectory, manifest.rulePaths),
    testFiles: await readAll(manifest.assetDirectory, manifest.testPaths),
  }))
);

const target = join(packageRoot, "assets", "reference.json");
await writeFile(
  target,
  `${JSON.stringify(buildDemoReference(rules), undefined, 2)}\n`,
  "utf8"
);
console.log(`Wrote ${target}`);
