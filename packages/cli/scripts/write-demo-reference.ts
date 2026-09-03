/**
 * Regenerate `assets/demo-runtime-reference.json` from the shipped rule.
 *
 * The reference payload is the demonstration rule expressed in the retrieval
 * response shape, so the generator team can use it as an eval target: the
 * assertion becomes "can the generator produce something equivalent to this"
 * against an example that lives with the code that executes it.
 *
 * Reads the asset files directly rather than importing `rule.ts`, whose `?raw`
 * specifiers only resolve under a vite transform. Both read
 * {@link DEMO_RUNTIME_PATHS}, and `test/demo-reference.test.ts` asserts they
 * agree.
 *
 * Run: pnpm --filter @taskless/cli demo:reference
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildDemoReference } from "../src/rules/demo/reference";
import {
  DEMO_RUNTIME_PATHS,
  DEMO_RUNTIME_RULE_ID,
} from "../src/rules/demo/manifest";

const packageRoot = join(import.meta.dirname, "..");
const assetRoot = join(packageRoot, "assets", "demo-runtime");

const files = await Promise.all(
  DEMO_RUNTIME_PATHS.map(async (path) => ({
    path,
    content: await readFile(join(assetRoot, path), "utf8"),
  }))
);

const target = join(packageRoot, "assets", "demo-runtime-reference.json");
await writeFile(
  target,
  `${JSON.stringify(buildDemoReference(DEMO_RUNTIME_RULE_ID, files), undefined, 2)}\n`,
  "utf8"
);
console.log(`Wrote ${target}`);
