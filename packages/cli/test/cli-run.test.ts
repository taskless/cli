import { describe, expect, it, vi } from "vitest";

import { emitRunEvents, resolveCommandName } from "../src/telemetry-run";
import { CLIError } from "../src/util/cli-error";

describe("resolveCommandName", () => {
  it.each([
    [["info"], "info"],
    [["check", "--json"], "check"],
    [["rule", "create"], "rule create"],
    [["rule"], "rule"],
    [["agent", "route"], "agent"],
    [["-d", "/tmp", "check"], "check"],
    [["--dir", "/tmp", "info"], "info"],
    [[], "(default)"],
  ])("resolves %j to %s", (argv, expected) => {
    expect(resolveCommandName(argv)).toBe(expected);
  });
});

function fakeTelemetry() {
  return { capture: vi.fn() };
}

const anon = { anonymous: true, loggedIn: false };

describe("emitRunEvents", () => {
  it("emits exactly one cli_run on success, with no cli_error and no version property", () => {
    const telemetry = fakeTelemetry();
    emitRunEvents(telemetry, {
      command: "info",
      success: true,
      durationMs: 5,
      ...anon,
    });

    expect(telemetry.capture).toHaveBeenCalledTimes(1);
    expect(telemetry.capture).toHaveBeenCalledWith(
      "cli_run",
      expect.objectContaining({
        command: "info",
        success: true,
        duration_ms: 5,
        anonymous: true,
        logged_in: false,
      })
    );
    // Version rides on the standard cli_version property the telemetry client
    // attaches, so emitRunEvents must not add one of its own.
    const properties = telemetry.capture.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(properties).not.toHaveProperty("cli_version");
  });

  it("emits cli_error then cli_run, in that order and exactly twice", () => {
    const telemetry = fakeTelemetry();
    emitRunEvents(telemetry, {
      command: "rule create",
      success: false,
      durationMs: 9,
      ...anon,
      error: new CLIError("nope", "AUTH_REQUIRED"),
    });

    expect(telemetry.capture).toHaveBeenCalledTimes(2);
    expect(telemetry.capture).toHaveBeenNthCalledWith(1, "cli_error", {
      command: "rule create",
      code: "AUTH_REQUIRED",
    });
    expect(telemetry.capture).toHaveBeenNthCalledWith(
      2,
      "cli_run",
      expect.objectContaining({ command: "rule create", success: false })
    );
  });

  it("falls back to INTERNAL_ERROR for a thrown non-CLIError", () => {
    const telemetry = fakeTelemetry();
    emitRunEvents(telemetry, {
      command: "info",
      success: false,
      durationMs: 1,
      ...anon,
      error: new Error("boom"),
    });

    expect(telemetry.capture).toHaveBeenCalledWith("cli_error", {
      command: "info",
      code: "INTERNAL_ERROR",
    });
  });

  it("does NOT emit cli_error for an exitCode-only failure (no thrown error)", () => {
    const telemetry = fakeTelemetry();
    emitRunEvents(telemetry, {
      command: "check",
      success: false,
      durationMs: 3,
      ...anon,
      // no error — failure signalled via process.exitCode
    });

    expect(telemetry.capture).toHaveBeenCalledTimes(1);
    expect(telemetry.capture).toHaveBeenCalledWith(
      "cli_run",
      expect.objectContaining({ success: false })
    );
    const events = telemetry.capture.mock.calls.map(
      (call) => call[0] as string
    );
    expect(events).not.toContain("cli_error");
  });

  it("reflects an authenticated identity as logged_in", () => {
    const telemetry = fakeTelemetry();
    emitRunEvents(telemetry, {
      command: "info",
      success: true,
      durationMs: 2,
      anonymous: false,
      loggedIn: true,
    });

    expect(telemetry.capture).toHaveBeenCalledWith(
      "cli_run",
      expect.objectContaining({ anonymous: false, logged_in: true })
    );
  });
});
