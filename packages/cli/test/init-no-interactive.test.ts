import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Run a real install in `cwd`, then rewrite the recorded version. */
async function installAtVersion(cwd: string, version: string): Promise<void> {
  await execFileAsync("node", [binPath, "init", "-d", cwd]);
  const manifestPath = join(cwd, ".taskless", "taskless.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    install?: { cliVersion?: string };
  };
  if (manifest.install) manifest.install.cliVersion = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

describe("taskless init (the batch install)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-init-noi-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("installs the consolidated skill to detected tools without any prompt", async () => {
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain("Claude Code (.claude/)");

    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("falls back to .agents/ when no tools are detected", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain("No tools detected. Using fallback: .agents/");
    expect(
      await exists(join(cwd, ".agents", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("does not prompt for authentication (no device code URL printed)", async () => {
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    const combined = stdout + stderr;
    expect(combined).not.toContain("Log in to taskless.io");
    expect(combined).not.toContain("Open this URL in your browser");
    expect(combined).not.toContain("Enter code:");
  });

  it("installs under a pipe with no notice about it", async () => {
    // Invoking via execFile makes stdout not-a-TTY. `init` used to detect
    // that and announce it was switching to the batch path; it IS the batch
    // path now, so there is nothing to switch to and nothing to announce.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stderr).not.toContain("non-interactive");
    expect(stdout).toContain("Claude Code (.claude/)");
  });

  it("treats a legacy --no-interactive flag as a no-op", async () => {
    // The flag selected this path and is no longer defined. A script that
    // still spells it out gets the same install, not an error.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "init",
      "--no-interactive",
      "-d",
      cwd,
    ]);

    expect(stderr).not.toContain("Unknown");
    expect(stdout).toContain("Claude Code (.claude/)");
    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("falls back to .agents/ when no tools are detected", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain("No tools detected. Using fallback: .agents/");
    expect(
      await exists(join(cwd, ".agents", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("`taskless update` no longer installs anything", async () => {
    // `update` used to be a second name for this install path. It now means
    // the rules ledger, and installing is what running the CLI does on its
    // own. Pinned because the two words are close enough that a future change
    // could quietly wire installing back into it, and nothing else would
    // notice: the install would simply start happening again.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    await execFileAsync("node", [binPath, "update", "-d", cwd]);

    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(false);
  });

  it("writes taskless.json with install state recorded", async () => {
    await mkdir(join(cwd, ".claude"), { recursive: true });

    await execFileAsync("node", [binPath, "init", "-d", cwd]);

    const manifest = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { version: number; install: Record<string, unknown> };

    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.install).toBeDefined();
  });

  it("prints a trailer mentioning /tskl onboard when commands were installed", async () => {
    // Claude Code receives commands, so the trailer should mention the
    // slash command form and the skill (both work) plus the bare CLI.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toMatch(/Next:.*\/tskl onboard/);
    expect(stdout).toMatch(/Taskless skill/);
    expect(stdout).toMatch(/`taskless onboard`/);
  });

  it("prints a skill-only trailer when no commands were installed", async () => {
    // .agents/ fallback receives no commands. The trailer should NOT mention
    // /tskl onboard but SHOULD mention the skill and the bare CLI.
    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).not.toContain("/tskl onboard");
    expect(stdout).toMatch(/Taskless skill/);
    expect(stdout).toMatch(/`taskless onboard`/);
  });

  it("prints an upgrade trailer naming the changed directories, before the onboarding trailer", async () => {
    // An agent that `check` sent here reads success and goes back to `check`.
    // The trailer is what tells it the stubs it just rewrote belong in its
    // commit. The onboarding trailer stays the final line: several scenarios
    // pin it there, and an agent reads all of stdout anyway.
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await installAtVersion(cwd, "0.0.1-previous");

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    // Forcing a rewrite: the recorded version moved, so the canonical store
    // and every stub are written again.
    expect(stdout).toContain("belong in your next commit");
    expect(stdout).toContain(".taskless/");
    expect(stdout).toContain(".claude/");
    expect(stdout).toContain("moved from 0.0.1-previous to");
    expect(stdout).toMatch(/Run `.* update`/);

    // Order: upgrade trailer, then the reload banner (the version moved, so
    // it prints), then the onboarding line last.
    const lines = stdout.trimEnd().split("\n");
    const trailerAt = lines.findIndex((line) => line.includes("next commit"));
    const reloadAt = lines.findIndex((line) => line.includes("Reload skills"));
    expect(trailerAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(trailerAt);
    expect(lines.at(-1)).toMatch(/^Next:/);
  });

  it("omits the update pointer when the version did not move", async () => {
    // A change without an upgrade is still something to commit, but there is
    // no ledger to walk: `update` would report nothing.
    await installAtVersion(cwd, "0.0.1-previous");
    // Rewrite at the previous version so the next run sees no move but has
    // to re-write the stubs it finds stale.
    await execFileAsync("node", [binPath, "init", "-d", cwd]);
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain("belong in your next commit");
    expect(stdout).toContain(".claude/");
    expect(stdout).not.toContain("moved from");
    expect(stdout).not.toMatch(/Run `.* update`/);
  });

  it("prints no upgrade trailer when a re-install changed nothing", async () => {
    // A no-op has nothing to commit and nothing to reconcile. A trailer that
    // said so would teach an agent to skim it.
    await execFileAsync("node", [binPath, "init", "-d", cwd]);

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).not.toContain("next commit");
    expect(stdout).not.toContain("moved from");
  });

  it("`taskless update` does NOT print the onboarding trailer", async () => {
    // Update is the same install plumbing but the trailer is scoped to init.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      binPath,
      "update",
      "-d",
      cwd,
    ]);

    expect(stdout).not.toMatch(/Next:.*onboard/);
    expect(stdout).not.toContain("/tskl onboard");
  });

  it("prints the trailer (and preserves install.onboarded) when re-running init on top of onboarded:true", async () => {
    // Re-install on top of an existing onboarded:true manifest. The trailer
    // is informational, not gated on the manifest state, so it MUST still
    // print. install.onboarded MUST survive the re-install (writeInstallState
    // preserves it explicitly so init never silently wipes onboarding).
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toMatch(/Next:.*onboard/);

    const manifest = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { install?: { onboarded?: boolean } };
    expect(manifest.install?.onboarded).toBe(true);
  });

  /**
   * The banner is wired up, not merely returned.
   *
   * `reload-notice.test.ts` covers the decision thoroughly as a pure function.
   * What it cannot see is whether `init` calls it and prints the result, and
   * that is where this feature fails silently: a dropped `console.log` or a
   * swapped field leaves every unit test green while the user is told nothing
   * and their agent keeps serving the previous skills.
   */
  describe("the restart-your-agents banner", () => {
    it("prints on a second install whose recorded version moved", async () => {
      // Planting an older version is what makes the next run an upgrade. The
      // build under test cannot report two versions in one process, so the
      // move is staged in the manifest rather than by installing twice.
      await installAtVersion(cwd, "0.0.1-planted");

      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "-d",
        cwd,
      ]);

      expect(stdout).toContain("RESTART YOUR AGENTS");
      // The version it moved FROM, which is the half a reader needs to tell an
      // upgrade from a downgrade.
      expect(stdout).toContain("0.0.1-planted");
    });

    it("stays quiet on a first install", async () => {
      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "-d",
        cwd,
      ]);

      expect(stdout).not.toContain("RESTART YOUR AGENTS");
    });

    it("stays quiet when the recorded version did not move", async () => {
      // The re-run case. A banner here would appear on every ordinary install
      // and train people to scroll past it.
      await execFileAsync("node", [binPath, "init", "-d", cwd]);

      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "-d",
        cwd,
      ]);

      expect(stdout).not.toContain("RESTART YOUR AGENTS");
    });
  });
});
