import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-process rather than through the built CLI: the notice only appears when
// telemetry is ON, and a spawned CLI with telemetry on would send real events.
// The mock keeps the wording out of this file; telemetry.test.ts asserts it.
let telemetryEnabled = true;
const isTelemetryEnabled = vi.hoisted(() =>
  vi.fn<(cwd?: string) => Promise<boolean>>()
);
vi.mock("../src/telemetry", () => ({
  getTelemetry: () =>
    Promise.resolve({ capture: () => {}, shutdown: () => Promise.resolve() }),
  isTelemetryEnabled,
  TELEMETRY_NOTICE: "<telemetry notice>",
  shutdownTelemetry: () => Promise.resolve(),
}));

const { initCommand } = await import("../src/commands/init");
const { getOnboardTrailer } = await import("../src/commands/onboard");

interface RunnableCommand {
  run: (context: {
    args: Record<string, unknown>;
    rawArgs: string[];
  }) => Promise<void>;
}

describe("init tells the user about telemetry", () => {
  let cwd: string;
  let home: string;
  let output: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-init-telemetry-"));
    home = await mkdtemp(join(tmpdir(), "taskless-init-telemetry-home-"));
    vi.stubEnv("HOME", home);
    telemetryEnabled = true;
    isTelemetryEnabled.mockReset();
    isTelemetryEnabled.mockImplementation(() =>
      Promise.resolve(telemetryEnabled)
    );
    output = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      output.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  function init(json: boolean) {
    return (initCommand as unknown as RunnableCommand).run({
      args: { dir: cwd, json, anonymous: false },
      rawArgs: [],
    });
  }

  it("prints the notice once, with the onboarding trailer still last", async () => {
    await init(false);

    expect(output.filter((line) => line === "<telemetry notice>")).toHaveLength(
      1
    );
    // One `console.log` call per entry, and the trailer is a single two-line
    // call, so the last entry is the whole trailer.
    expect(output.at(-1)).toBe(getOnboardTrailer());
    expect(isTelemetryEnabled).toHaveBeenCalledWith(cwd);
  });

  it("prints nothing about telemetry when it is off", async () => {
    telemetryEnabled = false;
    await init(false);

    expect(output).not.toContain("<telemetry notice>");
  });

  it.each([true, false])(
    "reports telemetry.enabled: %s on the --json envelope",
    async (enabled) => {
      telemetryEnabled = enabled;
      await init(true);

      const envelope = JSON.parse(output.join("\n")) as {
        telemetry?: { enabled?: boolean };
      };
      expect(envelope.telemetry).toEqual({ enabled });
      expect(output.join("\n")).not.toContain("<telemetry notice>");
    }
  );
});
