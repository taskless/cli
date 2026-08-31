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
  await execFileAsync("node", [binPath, "init", "--no-interactive", "-d", cwd]);
  const manifestPath = join(cwd, ".taskless", "taskless.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    install?: { cliVersion?: string };
  };
  if (manifest.install) manifest.install.cliVersion = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

describe("taskless init --no-interactive", () => {
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
      "--no-interactive",
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
      "--no-interactive",
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
      "--no-interactive",
      "-d",
      cwd,
    ]);

    const combined = stdout + stderr;
    expect(combined).not.toContain("Log in to taskless.io");
    expect(combined).not.toContain("Open this URL in your browser");
    expect(combined).not.toContain("Enter code:");
  });

  it("auto-detects non-interactive context when no TTY and no flag", async () => {
    // Invoking via execFile makes stdout not-a-TTY, which should trigger
    // the auto-switch notice.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stderr).toContain("Detected non-interactive context");
    expect(stdout).toContain("Claude Code (.claude/)");
  });

  it("falls back to .agents/ when no tools are detected", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "--no-interactive",
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

    await execFileAsync("node", [
      binPath,
      "init",
      "--no-interactive",
      "-d",
      cwd,
    ]);

    const manifest = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { version: number; install: Record<string, unknown> };

    expect(manifest.version).toBe(5);
    expect(manifest.install).toBeDefined();
  });

  it("prints a trailer mentioning /tskl onboard when commands were installed", async () => {
    // Claude Code receives commands, so the trailer should mention the
    // slash command form and the skill (both work) plus the bare CLI.
    await mkdir(join(cwd, ".claude"), { recursive: true });

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "--no-interactive",
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
      "--no-interactive",
      "-d",
      cwd,
    ]);

    expect(stdout).not.toContain("/tskl onboard");
    expect(stdout).toMatch(/Taskless skill/);
    expect(stdout).toMatch(/`taskless onboard`/);
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
      "--no-interactive",
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
        "--no-interactive",
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
        "--no-interactive",
        "-d",
        cwd,
      ]);

      expect(stdout).not.toContain("RESTART YOUR AGENTS");
    });

    it("stays quiet when the recorded version did not move", async () => {
      // The re-run case. A banner here would appear on every ordinary install
      // and train people to scroll past it.
      await execFileAsync("node", [
        binPath,
        "init",
        "--no-interactive",
        "-d",
        cwd,
      ]);

      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "--no-interactive",
        "-d",
        cwd,
      ]);

      expect(stdout).not.toContain("RESTART YOUR AGENTS");
    });
  });
});
