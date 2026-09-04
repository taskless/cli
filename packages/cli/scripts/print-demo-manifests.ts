/**
 * Write each shipped demo rule as
 * `<engine> <ruleId> <assetDirectory> <path>...`.
 *
 * Exists so CI can stage every sample without restating the list in YAML,
 * where a fourth sample would be added to the manifest and silently not staged.
 *
 * The trailing paths are {@link writtenPaths}, not the asset directory's
 * contents, so a staging loop copies exactly what `taskless demo` writes. A
 * whole-directory copy would additionally land `prompt.md`, which the command
 * never writes, and the job would then be attributing results to a tree no
 * user ever has.
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

import { DEMO_MANIFESTS, writtenPaths } from "../src/rules/demo/manifest";

const target = process.argv[2];
if (target === undefined) {
  throw new Error("usage: print-demo-manifests <output-path>");
}

const lines = DEMO_MANIFESTS.map(
  (manifest) =>
    `${manifest.engine} ${manifest.ruleId} ${manifest.assetDirectory} ${writtenPaths(manifest).join(" ")}`
);
await writeFile(target, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${String(lines.length)} manifest lines to ${target}`);
