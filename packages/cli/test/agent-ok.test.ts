import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/**
 * Stub the registry: `latest` names the published version, or `undefined`
 * for a registry that answers with nothing usable. The suite runs as a
 * release build, so without this `agent ok` would ask the real registry.
 */
function stubRegistry(latest?: string) {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      latest === undefined
        ? new Response("{}", { status: 404 })
        : Response.json({ latest })
    )
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

/** Every path under `root` with its size and mtime. */
function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    const stats = statSync(join(root, name));
    entries[name] = `${String(stats.size)}:${String(stats.mtimeMs)}`;
  }
  return entries;
}

describe("agent ok", () => {
  let directory: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    capture.mockClear();
    // Cleared so these tests can drive the lookup, which means every test in
    // this file must stub `fetch`: the default registry answers nothing, and a
    // test that needs a version stubs its own over it. Without this a test that
    // never mentions the registry would reach the real one.
    vi.stubEnv("NO_UPDATE_NOTIFIER", "");
    stubRegistry();
    process.exitCode = undefined;
    directory = mkdtempSync(join(tmpdir(), "taskless-agent-ok-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  });

  function printed(): string[] {
    return logSpy.mock.calls.map((call) => String(call[0]));
  }

  function output(): string {
    return printed().join("\n");
  }

  it("serves the recipe with the up-to-date passage and succeeds", async () => {
    stubRegistry();
    await runAgent(directory, ["agent", "ok"]);
    expect(output()).toMatch(/^# Topic: ok /);
    expect(output()).toContain(
      "Your Taskless environment is up to date and you can proceed."
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("carries no fetch-time directive", async () => {
    stubRegistry();
    await runAgent(directory, ["agent", "ok"]);
    expect(output()).not.toContain("Resolved by the CLI when you fetched it");
  });

  it("reports a newer published CLI and hands the steps to the user", async () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_event", "npx");
    stubRegistry("999.0.0");
    await runAgent(directory, ["agent", "ok"]);
    expect(output()).toContain(
      "Your Taskless environment is out of date, the following steps are needed in order for commands to work reliably:"
    );
    expect(output()).toContain("npx @taskless/cli@999.0.0");
    expect(output()).toContain("Do not run these steps yourself.");
    expect(output()).toMatch(/run `npx @taskless\/cli@\S+ agent ok` again/);
  });

  it("does not guess a launcher it cannot detect", async () => {
    vi.stubEnv("npm_command", "");
    vi.stubEnv("npm_lifecycle_event", "");
    vi.stubEnv("npm_config_user_agent", "");
    stubRegistry("999.0.0");
    await runAgent(directory, ["agent", "ok"]);
    expect(output()).toContain("<package-manager-dlx> @taskless/cli@999.0.0");
  });

  it("is silent when the registry lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );
    await runAgent(directory, ["agent", "ok"]);
    expect(output()).toContain(
      "Your Taskless environment is up to date and you can proceed."
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("does not ask the registry in CI", async () => {
    vi.stubEnv("CI", "true");
    const fetcher = stubRegistry("999.0.0");
    await runAgent(directory, ["agent", "ok"]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not ask the registry when NO_UPDATE_NOTIFIER is set", async () => {
    vi.stubEnv("NO_UPDATE_NOTIFIER", "1");
    const fetcher = stubRegistry("999.0.0");
    await runAgent(directory, ["agent", "ok"]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not create .taskless/", async () => {
    stubRegistry();
    await runAgent(directory, ["agent", "ok"]);
    expect(existsSync(join(directory, ".taskless"))).toBe(false);
  });

  it("writes nothing under an existing .taskless/", async () => {
    stubRegistry();
    const taskless = join(directory, ".taskless");
    mkdirSync(taskless);
    writeFileSync(join(taskless, "taskless.json"), '{"version": 1}\n');
    const before = snapshot(taskless);
    await runAgent(directory, ["agent", "ok"]);
    expect(snapshot(taskless)).toEqual(before);
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
