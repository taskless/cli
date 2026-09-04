/**
 * Regenerate `assets/demo-reference.json` from the shipped rules.
 *
 * The reference payload is every demonstration rule expressed in the retrieval
 * response shape, so another team can use it as an eval target: the assertion
 * becomes "can the generator produce something equivalent to this" against
 * examples that live with the code that executes them.
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

const rules = await Promise.all(
  DEMO_MANIFESTS.map(async (manifest) => ({
    engine: manifest.engine,
    ruleId: manifest.ruleId,
    files: await Promise.all(
      manifest.paths.map(async (path) => ({
        path,
        content: await readFile(
          join(packageRoot, "assets", manifest.assetDirectory, path),
          "utf8"
        ),
      }))
    ),
  }))
);

const target = join(packageRoot, "assets", "demo-reference.json");
await writeFile(
  target,
  `${JSON.stringify(buildDemoReference(rules), undefined, 2)}\n`,
  "utf8"
);
console.log(`Wrote ${target}`);
