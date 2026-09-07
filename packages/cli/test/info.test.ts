import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const agentRecipeDirectory = resolve(import.meta.dirname, "../src/agent");

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
}

async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      env: {
        ...process.env,
        DO_NOT_TRACK: "1",
        TASKLESS_TELEMETRY_DISABLED: "1",
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const error_ = error as ExecError;
    return {
      stdout: error_.stdout ?? "",
      stderr: error_.stderr ?? "",
      exitCode: error_.code ?? 1,
    };
  }
}

interface InfoJson {
  success: boolean;
  install: Record<string, unknown>;
  [key: string]: unknown;
}

async function info(cwd: string): Promise<InfoJson> {
  const { stdout, exitCode } = await runCli(
    ["info", "--json", "--anonymous", "-d", cwd],
    cwd
  );
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as InfoJson;
}

/**
 * Every `install.<key>` reference in a recipe, collected straight from the
 * recipe text rather than hand-maintained here. This is what keeps this test
 * load-bearing: a recipe added later that reads a new `install.*` field
 * fails this test the moment the payload doesn't carry it, with no separate
 * update to remember.
 *
 * The extraction is a plain identifier-after-dot match, not a prose parser:
 * it only ever matches the literal dotted reference an agent would copy out
 * of the recipe to read the field (`install.onboarded`), so it can't
 * misfire on sentences that merely contain the word "install".
 */
async function installKeysReferencedByRecipes(): Promise<Set<string>> {
  const entries = await readdir(agentRecipeDirectory, { withFileTypes: true });
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const text = await readFile(join(agentRecipeDirectory, entry.name), "utf8");
    for (const match of text.matchAll(
      /\binstall\.([A-Za-z_][A-Za-z0-9_]*)\b/g
    )) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
  return keys;
}

describe("taskless info --json", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-info-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("surfaces every install.* key the recipes reference", async () => {
    const referencedKeys = await installKeysReferencedByRecipes();
    // Guard the guard: if this ever comes back empty, the regex or the
    // recipe directory moved and the test would pass vacuously.
    expect(referencedKeys.size).toBeGreaterThan(0);

    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: LATEST_SCHEMA_VERSION,
        install: { cliVersion: "0.1.0", onboarded: true },
      }),
      "utf8"
    );

    const result = await info(cwd);

    for (const key of referencedKeys) {
      expect(result.install).toHaveProperty(key);
    }
  });

  it("reports install.onboarded: false when the manifest omits it", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: LATEST_SCHEMA_VERSION,
        install: { cliVersion: "0.1.0" },
      }),
      "utf8"
    );

    const result = await info(cwd);

    // Absent must read as "not onboarded", the same way the `onboard`
    // command's own gate treats a missing field
    // (`manifest.install?.onboarded === true`). Reporting `null` here would
    // send an agent following the onboard recipe down a full re-discovery
    // pass on a project that already onboarded successfully.
    expect(result.install.onboarded).toBe(false);
  });

  it("reports install.onboarded: true once onboarding is marked complete", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: LATEST_SCHEMA_VERSION,
        install: { cliVersion: "0.1.0", onboarded: true },
      }),
      "utf8"
    );

    const result = await info(cwd);

    expect(result.install.onboarded).toBe(true);
  });
});
