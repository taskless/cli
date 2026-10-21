import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import { builtCli, builtCliVersion } from "./support/built-cli";

const execFileAsync = promisify(execFile);

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [builtCli(), ...args],
      { env: { ...process.env, TASKLESS_TELEMETRY_DISABLED: "1", ...env } }
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code?: number };
    return {
      stdout: failure.stdout,
      stderr: failure.stderr,
      exitCode: failure.code ?? 1,
    };
  }
}

/**
 * The built CLI, run in a project that records a different version of it.
 * The decision itself is unit-tested in version-gate.test.ts; this holds the
 * wiring: the gate runs before dispatch, renders under `--json`, and leaves
 * the exempt commands alone.
 */
describe("the version-pin gate", () => {
  let cwd: string;

  async function record(cliVersion: string): Promise<void> {
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: LATEST_SCHEMA_VERSION,
        install: { cliVersion },
      })
    );
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-pin-gate-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("refuses check when the project records another version", async () => {
    await record("0.0.1");
    const result = await runCli(["check", "--json", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(envelope).toMatchObject({
      ok: false,
      code: "CLI_VERSION_MISMATCH",
    });
    expect(envelope.message).toContain("0.0.1");
    expect(envelope.message).toContain(builtCliVersion());
  });

  it("refuses in prose without --json", async () => {
    await record("0.0.1");
    const result = await runCli(["rule", "list", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("as recorded in .taskless/taskless.json");
  });

  it("lets info run, so the refusal can be diagnosed", async () => {
    await record("0.0.1");
    const result = await runCli(["info", "--json", "-d", cwd]);
    expect(result.exitCode).toBe(0);
  });

  it("does not refuse the recorded version", async () => {
    await record(builtCliVersion());
    const result = await runCli(["check", "--json", "-d", cwd]);
    expect(result.stdout).not.toContain("CLI_VERSION_MISMATCH");
  });

  it("does not refuse under the environment override", async () => {
    await record("0.0.1");
    const result = await runCli(["check", "--json", "-d", cwd], {
      TASKLESS_ALLOW_VERSION_MISMATCHES: "1",
    });
    expect(result.stdout).not.toContain("CLI_VERSION_MISMATCH");
  });
});
