import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

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

async function readJsonManifest(cwd: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(cwd, ".taskless", "taskless.json"), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("taskless onboard", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("bootstraps .taskless/ and prints the recipe on first run", async () => {
    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
    expect(stdout).toContain("## Goal");

    const manifest = await readJsonManifest(cwd);
    expect(manifest.version).toBe(5);
    // init/onboard alone should not record onboarded
    const install = manifest.install as { onboarded?: boolean } | undefined;
    expect(install?.onboarded).toBeUndefined();
  });

  it("refuses to print the recipe when install.onboarded is true", async () => {
    // Pre-populate the manifest with onboarded:true.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("already marked complete");
    expect(stdout).toContain("--force");
    expect(stdout).not.toContain("# Topic: onboard");
  });

  it("treats install.onboarded:false as not-onboarded and prints the recipe", async () => {
    // The 3-state semantics treat absent and false equivalently for gating
    // purposes; only true gates the recipe behind --force.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: false } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
    expect(stdout).not.toContain("already marked complete");
  });

  it("--force prints the recipe even when onboarded:true", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(
      ["onboard", "--force", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
  });

  it("--mark-complete writes onboarded:true and preserves other fields", async () => {
    // Seed the manifest with an existing install and an unknown top-level
    // field; --mark-complete must not clobber either.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: 2,
        install: {
          cliVersion: "0.7.0",
          targets: { ".claude": { skills: ["taskless"], commands: ["tskl"] } },
        },
        experimental: { keep: "me" },
      }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(
      ["onboard", "--mark-complete", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Marked Taskless onboarding as complete");

    const manifest = await readJsonManifest(cwd);
    const install = manifest.install as {
      onboarded?: boolean;
      cliVersion?: string;
      targets?: Record<string, unknown>;
    };
    expect(install.onboarded).toBe(true);
    expect(install.cliVersion).toBe("0.7.0");
    expect(install.targets).toEqual({
      ".claude": { skills: ["taskless"], commands: ["tskl"] },
    });
    expect(manifest.experimental).toEqual({ keep: "me" });
  });

  it("--mark-complete is idempotent", async () => {
    const first = await runCli(["onboard", "--mark-complete", "-d", cwd], cwd);
    expect(first.exitCode).toBe(0);
    const afterFirst = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );

    const second = await runCli(["onboard", "--mark-complete", "-d", cwd], cwd);
    expect(second.exitCode).toBe(0);
    const afterSecond = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );

    expect(afterSecond).toBe(afterFirst);
  });

  it("rejects --force --mark-complete with exit 1 and a clear error", async () => {
    const { stderr, exitCode } = await runCli(
      ["onboard", "--force", "--mark-complete", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--force");
    expect(stderr).toContain("--mark-complete");
  });

  it("`taskless agent onboard` matches the recipe printed by `taskless onboard --force`", async () => {
    // Pre-mark onboarded so the `onboard` path also prints the recipe via
    // --force, ensuring we compare recipe-vs-recipe rather than gate-vs-recipe.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const agentRecipe = await runCli(["agent", "onboard", "-d", cwd], cwd);
    const onboard = await runCli(["onboard", "--force", "-d", cwd], cwd);

    expect(agentRecipe.exitCode).toBe(0);
    expect(onboard.exitCode).toBe(0);
    expect(onboard.stdout.trim()).toBe(agentRecipe.stdout.trim());
  });
});

// #141: `taskless onboard` is the ONLY serving path for onboard.txt — it is
// not a topic `agent` dispatches — so it must detect and pass the invocation
// itself. The byte-parity test above cannot catch a regression here: both
// paths spawn a bare `node dist/index.js`, under which detection correctly
// returns undefined for BOTH, so they agree on marker-filled output while
// taking different code paths. Only a launcher-shaped environment separates
// them.
describe("onboard renders a real invocation, not the agent-fill marker", () => {
  let cwd: string;

  // The env npx sets, per the observations behind `detectLauncher`.
  const npxEnvironment = {
    npm_config_user_agent: "npm/11.8.0 node/v24.13.1 darwin arm64",
    npm_lifecycle_event: "npx",
    npm_command: "exec",
  };

  async function runUnderNpx(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      env: { ...process.env, ...npxEnvironment },
    });
    return stdout;
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-invocation-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("resolves the invocation when launched through npx", async () => {
    const stdout = await runUnderNpx(["onboard", "-d", cwd]);

    expect(stdout).toContain("npx @taskless/cli");
    expect(stdout).not.toContain("<taskless-cli>");
  });

  it("agrees with `agent onboard` under the same launcher", async () => {
    // The parity the bare-spawn test intends to assert, under an environment
    // where the two paths can actually disagree.
    const viaOnboard = await runUnderNpx(["onboard", "--force", "-d", cwd]);
    const viaAgent = await runUnderNpx(["agent", "onboard", "-d", cwd]);

    expect(viaOnboard.trim()).toBe(viaAgent.trim());
  });
});

// #140: the bullet list is authored before anything establishes what this
// repository can express, so an unroutable candidate reaches the user looking
// exactly like a good one. These guard the ordering and the annotation that
// makes the difference visible — and the boundary that keeps `route`'s
// criterion from being copied into a second recipe that can drift from it.
describe("onboard recipe establishes the routing surface first", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-route-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("sends the agent to both `route` and `detect` before it proposes", async () => {
    const { stdout, exitCode } = await runCli(
      ["agent", "onboard", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/agent route/);
    expect(stdout).toMatch(/detect --json/);
  });

  it("puts the routing step ahead of the bullet list, not after it", async () => {
    // The ordering is the whole fix. A recipe that mentions `route` somewhere
    // is what shipped before; what matters is that it is read while the list
    // is still being decided.
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    const routing = stdout.indexOf("Learn the routing surface");
    const synthesis = stdout.indexOf("Synthesize the bullet list");

    expect(routing).toBeGreaterThan(-1);
    expect(synthesis).toBeGreaterThan(-1);
    expect(routing).toBeLessThan(synthesis);
  });

  it("carries the destination in the bullet format", async () => {
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    expect(stdout).toContain("- <kebab-case-name> [<destination>]:");
    // The annotation is only useful if the agent knows the vocabulary, so the
    // recipe names the set rather than leaving it to be inferred.
    for (const destination of ["legacy", "sg", "vale", "runtime"]) {
      expect(stdout).toContain(`\`${destination}\``);
    }
  });

  it("defers the real decision to `route` rather than settling it here", async () => {
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    expect(stdout).toContain("provisional");
    // `route.txt` states the comparison is made there and only there. If this
    // recipe ever grows the destination table, this is what notices.
    expect(stdout).not.toContain("The rule is decided by");
    expect(stdout).not.toContain("create-remote-rule");
  });
});
