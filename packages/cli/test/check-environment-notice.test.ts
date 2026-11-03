import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentMeasurement } from "../src/install/freshness";
import { migrateFixture } from "./support/current-project";

/**
 * `check`'s out-of-date notice, run in-process so the measurement can be
 * controlled. What the measurement finds is `freshness.test.ts`'s subject;
 * this file is about how `check` wires it in: one notice, in both output
 * forms, never in CI, and never touching the exit code or the results.
 */

const measureEnvironment = vi.fn<() => Promise<EnvironmentMeasurement>>();
vi.mock("../src/install/freshness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/install/freshness")>();
  return { ...actual, measureEnvironment: () => measureEnvironment() };
});
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture: vi.fn(), shutdown: () => Promise.resolve() })
  ),
  shutdownTelemetry: () => Promise.resolve(),
  isTelemetryEnabled: () => false,
}));

const { checkCommand } = await import("../src/commands/check");

const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/mixed-engines-project"
);

const NEWER_CLI: EnvironmentMeasurement = {
  cli: { packageName: "@taskless/cli", running: "1.0.0", latest: "9.0.0" },
};

interface CheckJson {
  success: boolean;
  results: unknown[];
  notices?: string[];
}

/** Results as sorted JSON strings, since engines finish in any order. */
function sorted(results: unknown[]): string[] {
  return results.map((result) => JSON.stringify(result)).toSorted();
}

describe("check out-of-date notice", () => {
  let project: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-check-environment-"));
    await cp(fixturesDirectory, project, { recursive: true });
    await migrateFixture(["-d", project]);
    measureEnvironment.mockReset();
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    await rm(project, { recursive: true, force: true });
  });

  async function check(...extra: string[]): Promise<number | undefined> {
    await runCommand(checkCommand, { rawArgs: ["-d", project, ...extra] });
    const code = process.exitCode;
    process.exitCode = undefined;
    return typeof code === "number" ? code : undefined;
  }

  function json(): CheckJson {
    const line = logSpy.mock.calls.map((call) => String(call[0])).at(-1);
    return JSON.parse(line ?? "{}") as CheckJson;
  }

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
  }

  it("adds one notice to --json notices without changing the run", async () => {
    measureEnvironment.mockResolvedValue({});
    const baselineCode = await check("--json");
    const baseline = json();

    logSpy.mockClear();
    measureEnvironment.mockResolvedValue(NEWER_CLI);
    const code = await check("--json");
    const output = json();

    expect(code).toBe(baselineCode);
    expect(sorted(output.results)).toEqual(sorted(baseline.results));
    const added = (output.notices ?? []).filter((notice) =>
      notice.includes("out of date")
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("@taskless/cli@9.0.0");
  });

  it("prints the notice as a marked line in text output", async () => {
    measureEnvironment.mockResolvedValue(NEWER_CLI);
    await check();
    expect(stderr()).toContain(
      "Notice: Your Taskless environment is out of date:"
    );
  });

  it("adds nothing when the environment is up to date", async () => {
    measureEnvironment.mockResolvedValue({});
    await check("--json");
    expect(json().notices ?? []).not.toContainEqual(
      expect.stringContaining("out of date")
    );
  });

  it("does not measure in CI", async () => {
    vi.stubEnv("CI", "true");
    measureEnvironment.mockResolvedValue(NEWER_CLI);
    await check("--json");
    expect(measureEnvironment).not.toHaveBeenCalled();
    expect(json().notices ?? []).not.toContainEqual(
      expect.stringContaining("out of date")
    );
  });

  it("completes normally when the measurement fails", async () => {
    measureEnvironment.mockResolvedValue({});
    const baselineCode = await check("--json");
    const baseline = json();

    logSpy.mockClear();
    measureEnvironment.mockRejectedValue(new Error("boom"));
    const code = await check("--json");
    expect(code).toBe(baselineCode);
    expect(sorted(json().results)).toEqual(sorted(baseline.results));
  });
});
