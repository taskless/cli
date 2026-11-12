import process from "node:process";

import { nodeVersionProblem } from "./node-version";

/**
 * The package's `bin`: check the running Node against `engines.node`, then
 * load the CLI.
 *
 * The CLI is loaded with a dynamic `import()` on purpose. A static import
 * would link the CLI's whole module graph before this file's first line runs,
 * and on an older Node that link is what fails, with an error about a missing
 * export rather than about the Node version. Nothing this file imports
 * statically may need a newer Node than the oldest one it is meant to turn
 * away.
 */
const problem = nodeVersionProblem(
  __TASKLESS_NODE_ENGINE__,
  process.versions.node
);
if (problem === undefined) {
  await import("./index");
} else {
  process.stderr.write(`taskless: ${problem}\n`);
  process.exitCode = 1;
}
