import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the telemetry capture by mocking the telemetry module the agent
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

const { createAgentCommand } = await import("../src/commands/agent");

interface RunnableCommand {
  run: (context: {
    args: { dir: string; anonymous: boolean };
    rawArgs: string[];
  }) => Promise<void>;
}

describe("agent routing topics emit cli_help intent telemetry", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  let exitCode: typeof process.exitCode;

  beforeEach(() => {
    capture.mockClear();
    exitCode = process.exitCode;
    process.exitCode = 0;
    // Suppress the recipe text the command prints to stdout.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // The command sets `process.exitCode` on the process the suite runs in, so
    // it has to be put back or one failing topic would fail the whole run.
    process.exitCode = exitCode;
    logSpy.mockRestore();
  });

  // Every name here has a recipe in `src/help/`. That matters because the
  // command captures `cli_help` on both branches — topic found and topic not
  // found — so a list of removed topics would still satisfy the assertion
  // while pinning the unknown-topic path instead of routing. The exit code is
  // what tells the two apart: an unknown topic exits 1.
  it.each([
    "route",
    "create-legacy-rule",
    "create-sg-rule",
    "create-vale-rule",
    "create-runtime-rule",
    "create-remote-rule",
  ])("captures cli_help for %s and resolves it", async (topic) => {
    const command = createAgentCommand({}) as unknown as RunnableCommand;
    await command.run({
      args: { dir: process.cwd(), anonymous: false },
      rawArgs: ["agent", topic],
    });

    expect(capture).toHaveBeenCalledWith(
      "cli_help",
      expect.objectContaining({ topic })
    );
    expect(process.exitCode).toBe(0);
  });
});
