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
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

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

/**
 * The text of every boxed notice in `stdout`, rows joined back into one line,
 * so a phrase the box wrapped across two rows can be asserted on whole.
 */
function boxedText(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) => line.slice(1, -1).trim())
    .join(" ");
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
    expect(stdout).toMatch(/`(?:npx|pnpm dlx) @taskless\/cli@latest onboard`/);
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
    expect(stdout).toMatch(/`(?:npx|pnpm dlx) @taskless\/cli@latest onboard`/);
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

  it("names a package.json pin older than the running CLI, and leaves the pin alone", async () => {
    // The pin is what CI and `pnpm lint` run after an upgrade made through a
    // launcher. Offered, not applied: the install never edits package.json.
    const packageJson = JSON.stringify({
      devDependencies: { "@taskless/cli": "0.0.1" },
      scripts: { lint: "npx @taskless/cli@0.0.1 check" },
    });
    await writeFile(join(cwd, "package.json"), packageJson);
    await installAtVersion(cwd, "0.0.1-previous");

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    const notice = boxedText(stdout);
    expect(notice).toContain("UPDATE PINNED TASKLESS VERSIONS");
    expect(notice).toContain("devDependencies: @taskless/cli 0.0.1");
    expect(notice).toContain("scripts.lint: @taskless/cli 0.0.1");
    expect(notice).toMatch(/-> @taskless\/cli@\S+/);
    expect(notice).toContain("Offer to update them as shown");
    expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(packageJson);

    // After the upgrade trailer, which it follows from; the onboarding line
    // stays last.
    const lines = stdout.trimEnd().split("\n");
    const trailerAt = lines.findIndex((line) => line.includes("next commit"));
    const pinAt = lines.findIndex((line) => line.includes("package.json pins"));
    // Both present first: `findIndex` is -1 for a missing line, and -1 sorts
    // before everything, so the ordering check alone passes on an absent
    // trailer.
    expect(trailerAt).toBeGreaterThan(-1);
    expect(pinAt).toBeGreaterThan(trailerAt);
    expect(lines.at(-1)).toMatch(/^Next:/);
  });

  it("says CI will break when the same run migrated .taskless/", async () => {
    // The pinned CLI refuses a scaffold newer than it knows, and CI meets
    // that on the push carrying the migrated files. No hedging.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { "@taskless/cli": "0.0.1" } })
    );
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2 })
    );

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain(
      `from schema version 2 to ${String(LATEST_SCHEMA_VERSION)}`
    );
    expect(boxedText(stdout)).toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(boxedText(stdout)).toContain("same commit as .taskless/");
    expect(boxedText(stdout)).not.toContain("will likely fail");
  });

  it("does not call a fresh install an upgrade", async () => {
    // A fresh `init` creates `.taskless/` by migrating from schema 0. Nothing
    // was upgraded, and no layout the pin used to read has moved.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { "@taskless/cli": "0.0.1" } })
    );

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).toContain("devDependencies: @taskless/cli 0.0.1");
    expect(boxedText(stdout)).toContain("will likely fail");
    expect(boxedText(stdout)).not.toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(stdout).not.toContain("This upgrade migrated");
  });

  it("names a stale pin even when the re-install changed nothing", async () => {
    // Nothing to commit is not the same as nothing to fix: the pin and the
    // project still disagree.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { "@taskless/cli": "^0.0.1" } })
    );
    await execFileAsync("node", [binPath, "init", "-d", cwd]);

    const { stdout } = await execFileAsync("node", [
      binPath,
      "init",
      "-d",
      cwd,
    ]);

    expect(stdout).not.toContain("next commit");
    expect(stdout).toContain("devDependencies: @taskless/cli ^0.0.1");
    // Nothing migrated, so the layout the pin reads did not move.
    expect(boxedText(stdout)).toContain("will likely fail");
    expect(boxedText(stdout)).not.toContain("SCAFFOLD_VERSION_MISMATCH");
  });

  it("carries stale pins on the --json envelope, as an empty list when there are none", async () => {
    const bare = await execFileAsync("node", [
      binPath,
      "init",
      "--json",
      "-d",
      cwd,
    ]);
    expect(
      (JSON.parse(bare.stdout) as { pinnedCli: unknown }).pinnedCli
    ).toEqual([]);

    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { "@taskless/cli": "0.0.1" } })
    );
    const pinned = await execFileAsync("node", [
      binPath,
      "init",
      "--json",
      "-d",
      cwd,
    ]);
    expect(
      (JSON.parse(pinned.stdout) as { pinnedCli: unknown }).pinnedCli
    ).toEqual([
      {
        manifest: "package.json",
        location: "dependencies",
        name: "@taskless/cli",
        spec: "0.0.1",
        installed: null,
      },
    ]);
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
