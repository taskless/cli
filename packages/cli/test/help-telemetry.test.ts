import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on telemetry by mocking the module the agent command imports. The factory
// is invoked lazily at import time (same pattern as telemetry.test.ts).
const capture = vi.fn();
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture, shutdown: () => Promise.resolve() })
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

async function runAgent(rawArguments: string[]): Promise<void> {
  const command = createAgentCommand({}) as unknown as RunnableCommand;
  await command.run({
    args: { dir: process.cwd(), anonymous: false },
    rawArgs: rawArguments,
  });
}

describe("agent emits cli_help { topic }", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    capture.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("captures the served topic", async () => {
    await runAgent(["agent", "rule-create"]);
    expect(capture).toHaveBeenCalledWith("cli_help", { topic: "rule-create" });
  });

  it("captures the index marker for no topic", async () => {
    await runAgent(["agent"]);
    expect(capture).toHaveBeenCalledWith("cli_help", { topic: "(index)" });
  });

  it("captures the attempted topic for an unknown topic", async () => {
    await runAgent(["agent", "nope"]);
    expect(capture).toHaveBeenCalledWith("cli_help", { topic: "nope" });
  });

  // The rejected invocation is still an intent signal — it says an agent
  // reached for a topic by phrase rather than by token — so it is captured
  // under the same event with the attempted words joined for readability.
  it("captures the attempted words when too many positionals are given", async () => {
    await runAgent(["agent", "rule", "create"]);
    expect(capture).toHaveBeenCalledWith("cli_help", { topic: "rule create" });
  });
});

// Rather than asserting "no help_* event" inside every behavioral test above,
// prove it once at the source: after this change lands, no legacy help_* event
// name is emitted anywhere in the CLI.
function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("no legacy help_* event remains in the CLI source", () => {
  it("emits no help_* event-name literal under src/", () => {
    const sourceDirectory = resolve(import.meta.dirname, "../src");
    // Match a string/template literal that begins with help_ (e.g. "help_index",
    // "help_unknown", or a `help_${...}` topic event).
    const legacyHelpEvent = /["`]help_/;
    const offenders = collectSourceFiles(sourceDirectory).filter((file) =>
      legacyHelpEvent.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
