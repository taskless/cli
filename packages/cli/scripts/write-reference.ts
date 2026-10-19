/**
 * Regenerate `assets/reference.json` from the shipped rules.
 *
 * The corpus is every reference rule with the prompt it answers, the rule
 * itself, and the held-out cases — separately, so another team can run their
 * rule against our cases and ours against theirs.
 *
 * `test/reference.test.ts` builds the payload through the same reader and
 * asserts the committed file matches it.
 *
 * Run: pnpm --filter @taskless/cli reference
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildReference } from "../src/rules/reference";
import { readReferenceInputs } from "../src/rules/corpus/manifest";

const assetsRoot = join(import.meta.dirname, "..", "assets");

const target = join(assetsRoot, "reference.json");
await writeFile(
  target,
  `${JSON.stringify(buildReference(await readReferenceInputs(assetsRoot)), undefined, 2)}\n`,
  "utf8"
);
console.log(`Wrote ${target}`);
