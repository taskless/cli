import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

describe("--help below the root", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-help-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  // The defect was that `--help` fell through as an unknown flag and the
  // command body ran. Asserting only on output would pass against the broken
  // CLI, so this asserts `init` did not install anything.
  it.each(["--help", "-h"])(
    "%s on a leaf subcommand prints usage and runs nothing",
    async (flag) => {
      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        flag,
        "-d",
        temporaryDirectory,
      ]);

      expect(stdout).toContain("USAGE");
      expect(stdout).toContain("taskless init");
      // A real `init` writes a skills directory here (see cli.test.ts).
      expect(await readdir(temporaryDirectory)).toEqual([]);
    }
  );

  it("renders the nested subcommand's usage, not its parent's", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "auth",
      "login",
      "--help",
    ]);

    expect(stdout).toContain("auth login");
    expect(stdout).toContain("Authenticate with taskless.io");
    // `auth`'s own usage lists its subcommands; login's does not.
    expect(stdout).not.toContain("Remove saved authentication");
  });

  it("treats the token after -d as a flag value, not a subcommand", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "-d",
      temporaryDirectory,
      "check",
      "--help",
    ]);

    expect(stdout).toContain("taskless check");
    expect(stdout).toContain("Run Taskless rules against your codebase");
    // Falling back to the root would print the full command list.
    expect(stdout).not.toContain("Manage authentication with taskless.io");
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  it("leaves the root's --help unchanged", async () => {
    const { stdout } = await execFileAsync("node", [binPath, "--help"]);

    expect(stdout).toContain("Taskless CLI");
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("COMMANDS");
    expect(stdout).toContain("Manage authentication with taskless.io");
  });
});

// REGRESSION GUARD — DO NOT "SIMPLIFY" THE HELP PATH TO citty's runMain.
//
// runMain's help branch calls process.exit(0), which does not run `finally`
// blocks. The entry's finally block is what emits cli_run, the per-invocation
// telemetry denominator. Swapping in runMain would silently stop reporting
// every help (and every failed) invocation. This test fails in that world:
// either cli_run is never captured, or process.exit tears down the worker.
describe("help invocations still emit cli_run", () => {
  const capture = vi.fn();

  beforeEach(() => {
    capture.mockClear();
    vi.resetModules();
    vi.doMock("../src/telemetry", () => ({
      getTelemetry: () =>
        Promise.resolve({ capture, shutdown: () => Promise.resolve() }),
      resolveRunIdentity: () =>
        Promise.resolve({ anonymous: true, loggedIn: false }),
      shutdownTelemetry: () => Promise.resolve(),
    }));
  });

  afterEach(() => {
    vi.doUnmock("../src/telemetry");
    vi.resetModules();
  });

  it("captures cli_run for `info --help`", async () => {
    const argv = process.argv;
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    process.argv = ["node", "taskless", "info", "--help"];

    try {
      // Importing the entry runs the CLI: it is a top-level script.
      await import("../src/index");
    } finally {
      process.argv = argv;
      write.mockRestore();
    }

    expect(capture).toHaveBeenCalledWith(
      "cli_run",
      expect.objectContaining({ command: "info", success: true })
    );
  });
});
