import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cliRejectionToResult } from "./support/spawn-cli";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * These spawn the BUILT CLI rather than calling `runMigrations` directly, and
 * that is the point of the file.
 *
 * The bug (taskless/cli#389) was a `console.error` inside `runMigrations` on
 * top of the caller's own print, so it exists only in the seam between the two
 * layers; a unit test of `runMigrations` cannot see it. More importantly, the
 * failure mode opposite to a doubled line is SWALLOWING — a catch that stops
 * rethrowing would exit 0 and let `init` report success over a half-migrated
 * tree. Only a real process has an exit code, so the `exitCode` assertion in
 * each test below is the guard that matters, and the occurrence count is the
 * one that describes the bug.
 */
async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      cwd,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [binPath, ...args]);
  }
}

describe("a failing migration is reported exactly once", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-migration-failure-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    // Version 3 is below migration 4, so `init` runs the engine partition.
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 3 }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /**
   * A *file* where migration 4 needs the `sg/` engine directory. Its
   * `assertNoDirectoryConflicts` refuses with a coded `CLIError`
   * (SCAFFOLD_CONFLICT) before moving anything.
   */
  async function seedConflictingEngineDirectory(): Promise<void> {
    await writeFile(join(cwd, ".taskless", "sg"), "not a directory\n", "utf8");
  }

  /**
   * A file at `.taskless/rules` instead. Nothing checks that path, so the
   * migration reaches a bare `mkdir` and throws an EEXIST `Error` — an
   * unrecognized fault rather than a deliberate refusal. Both shapes doubled,
   * so both are pinned.
   */
  async function seedUnexpectedFault(): Promise<void> {
    await writeFile(
      join(cwd, ".taskless", "rules"),
      "not a directory\n",
      "utf8"
    );
  }

  it("prints a coded refusal once, naming the migration", async () => {
    await seedConflictingEngineDirectory();

    const result = await runCli(["init"], cwd);

    // The guard against swallowing: a catch that stopped rethrowing would
    // exit 0 here with `init` claiming success over a half-migrated tree.
    expect(result.exitCode).toBe(1);
    expect(result.stderr.match(/Cannot partition/g)).toHaveLength(1);
    // The migration number is the only thing naming WHICH migration refused —
    // the refusal's own text names `.taskless/sg` and never itself.
    expect(result.stderr).toMatch(
      /Migration 4 failed: Cannot partition \.taskless\//
    );
  });

  it("prints an unexpected fault once, naming the migration", async () => {
    await seedUnexpectedFault();

    const result = await runCli(["init"], cwd);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.match(/EEXIST/g)).toHaveLength(1);
    expect(result.stderr).toMatch(/Migration 4 failed: EEXIST/);
  });

  it("emits a stdout envelope under --json, naming the migration", async () => {
    await seedConflictingEngineDirectory();

    const result = await runCli(["init", "--json"], cwd);

    expect(result.exitCode).toBe(1);
    // It used to be empty: a machine consumer parsing stdout got nothing at
    // all and had only the exit code to read.
    expect(result.stdout.trim()).not.toBe("");
    const envelope = JSON.parse(result.stdout.trim()) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(envelope.ok).toBe(false);
    // The original code survives the wrap; re-coding to INTERNAL_ERROR would
    // cost an agent the one thing it branches on.
    expect(envelope.code).toBe("SCAFFOLD_CONFLICT");
    expect(envelope.message).toMatch(/^Migration 4 failed: /);
    expect(envelope.message).toContain("Cannot partition");
    // The envelope is the report, so nothing repeats it on stderr.
    expect(result.stderr).not.toMatch(/Cannot partition/);
  });

  it("emits an INTERNAL_ERROR envelope for an unexpected fault", async () => {
    await seedUnexpectedFault();

    const result = await runCli(["init", "--json"], cwd);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout.trim()) as {
      code: string;
      message: string;
    };
    expect(envelope.code).toBe("INTERNAL_ERROR");
    expect(envelope.message).toMatch(/^Migration 4 failed: EEXIST/);
  });
});
