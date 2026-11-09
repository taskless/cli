import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordReconciliation } from "../src/rules/reconcile-marker";
import { AST_GREP_VERSION, VALE_VERSION } from "../src/rules/capabilities";

/**
 * Which CLI is running decides what `recordReconciliation` stamps, and a
 * spawned release build cannot pose as one nightly against another. So the
 * version is mocked here, the same reason `reconciliation-start.test.ts` is a
 * unit test.
 */
const running = vi.hoisted(() => ({ version: "" }));
vi.mock("../src/wizard/intro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/wizard/intro")>()),
  getCliVersion: () => running.version,
}));

const NEWER_NIGHTLY = "0.12.0-20261101000000xaaaaaaa";
const OLDER_NIGHTLY = "0.12.0-20261001000000xbbbbbbb";

describe("recording a reconciliation from a nightly", () => {
  let cwd: string;
  const manifestPath = (): string => join(cwd, ".taskless", "taskless.json");

  async function writeRules(rules: Record<string, unknown>): Promise<void> {
    await writeFile(
      manifestPath(),
      JSON.stringify({ version: 1, rules }, undefined, 2)
    );
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-nightly-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("refuses an older nightly of the same release and leaves the engines", async () => {
    // Equal on the numeric core, so the ledger comparison let this through
    // and the older nightly stamped its own engines (taskless/cli#649).
    await writeRules({
      reconciledTo: NEWER_NIGHTLY,
      engines: { sg: AST_GREP_VERSION, vale: VALE_VERSION },
    });
    const before = await readFile(manifestPath(), "utf8");
    running.version = OLDER_NIGHTLY;

    await expect(recordReconciliation(cwd)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await readFile(manifestPath(), "utf8")).toBe(before);
  });

  it("records a newer nightly over an older one", async () => {
    await writeRules({
      reconciledTo: OLDER_NIGHTLY,
      engines: { sg: AST_GREP_VERSION, vale: VALE_VERSION },
    });
    running.version = NEWER_NIGHTLY;

    const result = await recordReconciliation(cwd);
    expect(result.reconciledTo).toBe(NEWER_NIGHTLY);
    expect(result.previous).toBe(OLDER_NIGHTLY);
  });
});
