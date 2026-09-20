import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasVersionFlag } from "../src/util/argv";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

describe("--version", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-version-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  // The defect was that both flags fell through to the bare-invocation usage
  // banner (taskless/cli#352). The exact match is the point: a script doing
  // `taskless --version | …` must see the version and nothing else.
  it.each(["--version", "-v"])(
    "%s prints exactly the version and a newline",
    async (flag) => {
      const { stdout, stderr } = await execFileAsync("node", [binPath, flag]);

      expect(stdout).toBe(`${__VERSION__}\n`);
      expect(stderr).toBe("");
    }
  );

  // Pinned: the flag is about the tool, not the subcommand, so it wins from
  // any position — the same rule `--help` follows. Before, `check --version`
  // dropped the unknown flag and ran a full check.
  it("prints the version in subcommand position and runs nothing", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "check",
      "--version",
      "-d",
      temporaryDirectory,
    ]);

    expect(stdout).toBe(`${__VERSION__}\n`);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  it("does not read a path after -- as a version request", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "check",
      "-d",
      temporaryDirectory,
      "--json",
      "--",
      "-v",
    ]);

    expect(stdout).not.toBe(`${__VERSION__}\n`);
    const parsed = JSON.parse(stdout.trim()) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  it("is listed in the root --help", async () => {
    const { stdout } = await execFileAsync("node", [binPath, "--help"]);

    expect(stdout).toContain("-v, --version");
    expect(stdout).toContain("Print the version and exit");
  });
});

describe("hasVersionFlag", () => {
  it.each([
    [["--version"], true],
    [["-v"], true],
    [["check", "--version"], true],
    [["-d", "/tmp", "check", "-v"], true],
    [["check"], false],
    // A path after `--`, and a directory that reads like a flag, are values.
    [["check", "--", "-v"], false],
    [["-d", "-v", "check"], false],
  ])("resolves %j to %s", (argv, expected) => {
    expect(hasVersionFlag(argv)).toBe(expected);
  });
});

// Same guard as help-flag.test.ts: the version path must return normally so
// the entry's `finally` still emits cli_run. Delegating to citty's runMain,
// which prints the version and calls process.exit(0), would drop it.
describe("version invocations still emit cli_run", () => {
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

  it("captures cli_run for `--version`", async () => {
    const argv = process.argv;
    // Collected here rather than read off the spy: `mockRestore` clears the
    // spy's recorded calls, and the restore must happen before any assertion.
    const written: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
    process.argv = ["node", "taskless", "--version"];

    try {
      // Importing the entry runs the CLI: it is a top-level script.
      await import("../src/index");
    } finally {
      process.argv = argv;
      write.mockRestore();
    }

    expect(written).toEqual([`${__VERSION__}\n`]);
    expect(capture).toHaveBeenCalledWith(
      "cli_run",
      expect.objectContaining({ success: true })
    );
  });
});
