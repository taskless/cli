import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the telemetry capture by mocking the telemetry module the help
// command imports. The factory is invoked lazily at import time, so the
// closure over `capture` resolves after initialization (same pattern as
// telemetry.test.ts mocking posthog-node).
const capture = vi.fn();
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({
      capture,
      shutdown: () => Promise.resolve(),
    })
  ),
  shutdownTelemetry: () => Promise.resolve(),
}));

const { createHelpCommand } = await import("../src/commands/help");

interface RunnableCommand {
  run: (context: {
    args: { dir: string; anonymous: boolean };
    rawArgs: string[];
  }) => Promise<void>;
}

describe("help routing topics emit cli_help intent telemetry", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    capture.mockClear();
    // Suppress the recipe text the command prints to stdout.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it.each(["route", "existing", "static", "remote", "engine-selection"])(
    "captures cli_help for %s",
    async (topic) => {
      const command = createHelpCommand({}) as unknown as RunnableCommand;
      await command.run({
        args: { dir: process.cwd(), anonymous: false },
        rawArgs: ["help", topic],
      });

      expect(capture).toHaveBeenCalledWith(
        "cli_help",
        expect.objectContaining({ topic })
      );
    }
  );
});
