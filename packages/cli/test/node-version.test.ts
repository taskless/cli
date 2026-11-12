import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeVersionProblem } from "../src/node-version";
import { builtDirectory, builtCliVersion } from "./support/built-cli";

/** The package's own `engines.node`, which the built bin was given. */
const REQUIRED = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
  ) as { engines: { node: string } }
).engines.node;

describe("nodeVersionProblem", () => {
  it.each([
    [">=22.22.0", "22.22.0"],
    [">=22.22.0", "22.22.1"],
    [">=22.22.0", "23.0.0"],
    [">=22.22.0", "24.14.0-pre"],
    [">=22", "22.0.0"],
    [">= 22.22", "22.22.0"],
  ])("lets %s run on %s", (required, running) => {
    expect(nodeVersionProblem(required, running)).toBeUndefined();
  });

  it.each([
    [">=22.22.0", "20.19.0"],
    [">=22.22.0", "22.21.9"],
    [">=22.22.0", "22.9.0"],
    [">=22.22.1", "22.22.0"],
  ])("stops %s on %s, naming both", (required, running) => {
    expect(nodeVersionProblem(required, running)).toBe(
      `Taskless needs Node ${required}, you have ${running}. ` +
        `Install a newer Node and run it again.`
    );
  });

  it.each([[null], [undefined], ["^22.22.0"], [">=22 <26"], ["22.x || 24.x"]])(
    "does not judge a range it cannot read: %s",
    (required) => {
      expect(nodeVersionProblem(required, "8.0.0")).toBeUndefined();
    }
  );
});

describe("the package bin", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "taskless-bin-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Run the built `bin`, seeing `version` as the running Node. */
  async function runAs(version: string, args: string[]) {
    const preload = join(root, "as-node.mjs");
    await writeFile(
      preload,
      `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });\n`
    );
    return spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(preload).href,
        join(builtDirectory(), "bin.js"),
        ...args,
      ],
      { cwd: root, encoding: "utf8" }
    );
  }

  it("names the required and running Node, and loads nothing else", async () => {
    const result = await runAs("20.19.0", ["init"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `taskless: Taskless needs Node ${REQUIRED}, you have 20.19.0. ` +
        "Install a newer Node and run it again.\n"
    );
  });

  it("starts the CLI on a Node the range admits", async () => {
    const result = await runAs(process.versions.node, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(builtCliVersion());
  });
});
