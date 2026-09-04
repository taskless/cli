/**
 * Write each shipped demo rule as `<engine> <ruleId> <assetDirectory>`.
 *
 * Exists so CI can stage every sample without restating the list in YAML,
 * where a fourth sample would be added to the manifest and silently not staged.
 *
 * Takes an output PATH rather than printing to stdout. Capturing stdout meant
 * capturing whatever the runner wrapped around it: `pnpm --filter ... > file`
 * interleaved pnpm's own platform warnings into the manifest, and the loop
 * reading it then tried to stage a rule called `WARN`. A file the script writes
 * itself cannot pick up a caller's noise.
 *
 * Run: pnpm --filter @taskless/cli demo:manifests <path>
 */

import { writeFile } from "node:fs/promises";

import { DEMO_MANIFESTS } from "../src/rules/demo/manifest";

const target = process.argv[2];
if (target === undefined) {
  throw new Error("usage: print-demo-manifests <output-path>");
}

const lines = DEMO_MANIFESTS.map(
  (manifest) =>
    `${manifest.engine} ${manifest.ruleId} ${manifest.assetDirectory}`
);
await writeFile(target, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${String(lines.length)} manifest lines to ${target}`);
