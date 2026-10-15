import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture, shutdown: () => Promise.resolve() })
  ),
  shutdownTelemetry: () => Promise.resolve(),
  isTelemetryEnabled: () => false,
}));

const { createAgentCommand } = await import("../src/commands/agent");

interface RunnableCommand {
  run: (context: {
    args: { dir: string; anonymous: boolean };
    rawArgs: string[];
  }) => Promise<void>;
}

async function runAgent(
  directory: string,
  rawArguments: string[]
): Promise<void> {
  const command = createAgentCommand({}) as unknown as RunnableCommand;
  await command.run({
    args: { dir: directory, anonymous: false },
    rawArgs: rawArguments,
  });
}

describe("agent ok", () => {
  let directory: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    capture.mockClear();
    process.exitCode = undefined;
    directory = mkdtempSync(join(tmpdir(), "taskless-agent-ok-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  function printed(): string[] {
    return logSpy.mock.calls.map((call) => String(call[0]));
  }

  it("prints one confirmation line and succeeds", async () => {
    await runAgent(directory, ["agent", "ok"]);
    expect(printed()).toHaveLength(1);
    expect(printed()[0]).toMatch(
      /^This message confirms you can run Taskless via .+\.$/
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("names the detected launcher and package", async () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_event", "npx");
    await runAgent(directory, ["agent", "ok"]);
    expect(printed()[0]).toMatch(
      /^This message confirms you can run Taskless via npx @taskless\/cli\S*@\S+\.$/
    );
  });

  it("does not guess a launcher it cannot detect", async () => {
    vi.stubEnv("npm_command", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("npm_config_user_agent", "");
    await runAgent(directory, ["agent", "ok"]);
    expect(printed()[0]).toBe(
      "This message confirms you can run Taskless via the command you just ran."
    );
  });

  it("does not create .taskless/", async () => {
    await runAgent(directory, ["agent", "ok"]);
    expect(existsSync(join(directory, ".taskless"))).toBe(false);
  });

  it("captures cli_agent with the ok topic", async () => {
    await runAgent(directory, ["agent", "ok"]);
    expect(capture).toHaveBeenCalledWith("cli_agent", { topic: "ok" });
  });

  it("is listed in the agent index", async () => {
    await runAgent(directory, ["agent"]);
    expect(printed()).toContainEqual(expect.stringMatching(/^ {2}ok\s+\S/));
  });
});
