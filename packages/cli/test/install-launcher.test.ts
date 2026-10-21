import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedSkills,
} from "../src/install/install";
import { renderLauncher } from "../src/install/launcher";
import { readInstallState, writeInstallState } from "../src/install/state";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-install-launcher-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function install(cliVersion: string) {
  return applyInstallPlan(
    cwd,
    buildInstallPlan([".claude"], getEmbeddedSkills()),
    { cliVersion }
  );
}

const LAUNCHER = join(".taskless", "bin", "cli.mjs");
const LOCKFILE = join(".taskless", "bin", "cli.lock.json");
const CACHE = join(".taskless", ".cache");
const SKILL = join(".taskless", "skills", "taskless", "SKILL.md");

describe("the release's install writes its launcher", () => {
  it("creates an executable cli.mjs and records the release's version", async () => {
    const result = await install("0.13.0");

    expect(result.launcher).toEqual({
      path: ".taskless/bin/cli.mjs",
      state: "created",
    });
    expect(await readFile(join(cwd, LAUNCHER), "utf8")).toBe(
      renderLauncher("@taskless/cli")
    );
    const { mode } = await stat(join(cwd, LAUNCHER));
    expect(mode & 0o111).not.toBe(0);
    await expect(
      stat(join(cwd, ".taskless", "bin", "cli-nightly.mjs"))
    ).rejects.toThrow();

    const state = await readInstallState(cwd);
    expect(state.launchers).toEqual({ "@taskless/cli": "0.13.0" });
    expect(state.cliVersion).toBe("0.13.0");
  });

  it("leaves the launcher and the skill byte-identical across an upgrade", async () => {
    await install("0.13.0");
    const launcher = await readFile(join(cwd, LAUNCHER), "utf8");
    const skill = await readFile(join(cwd, SKILL), "utf8");

    const result = await install("0.13.1");

    expect(result.launcher?.state).toBe("unchanged");
    expect(await readFile(join(cwd, LAUNCHER), "utf8")).toBe(launcher);
    expect(await readFile(join(cwd, SKILL), "utf8")).toBe(skill);
    const { launchers } = await readInstallState(cwd);
    expect(launchers).toEqual({
      "@taskless/cli": "0.13.1",
    });
  });

  it("restores an edited launcher and says so", async () => {
    await install("0.13.0");
    await writeFile(join(cwd, LAUNCHER), "#!/usr/bin/env node\n// edited\n");

    const result = await install("0.13.0");

    expect(result.launcher?.state).toBe("restored");
    expect(await readFile(join(cwd, LAUNCHER), "utf8")).toBe(
      renderLauncher("@taskless/cli")
    );
  });

  it("retires the nightly: its record, launcher, and lockfile", async () => {
    // Installing the release is the move back to mainline.
    await mkdir(join(cwd, ".taskless", "bin"), { recursive: true });
    await writeInstallState(cwd, {
      cliVersion: "0.14.0-20261020120000xabc1234",
      launchers: { "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" },
      targets: {},
    });
    await writeFile(join(cwd, ".taskless", "bin", "cli-nightly.mjs"), "");
    await writeFile(join(cwd, ".taskless", "bin", "cli-nightly.lock.json"), "");

    const result = await install("0.13.0");

    expect(result.retired).toEqual([
      ".taskless/bin/cli-nightly.mjs",
      ".taskless/bin/cli-nightly.lock.json",
    ]);
    await expect(
      stat(join(cwd, ".taskless", "bin", "cli-nightly.mjs"))
    ).rejects.toThrow();
    await expect(
      stat(join(cwd, ".taskless", "bin", "cli-nightly.lock.json"))
    ).rejects.toThrow();
    const { launchers } = await readInstallState(cwd);
    expect(launchers).toEqual({ "@taskless/cli": "0.13.0" });
  });

  it("retires nothing when there is no nightly", async () => {
    const result = await install("0.13.0");
    expect(result.retired).toEqual([]);
  });

  it("names the launcher in the installed skill", async () => {
    await install("0.13.0");
    const skill = await readFile(join(cwd, SKILL), "utf8");
    expect(skill).toContain("./.taskless/bin/cli.mjs agent");
    expect(skill).toContain("the directory that contains `.taskless/`");
  });
});

describe("the release's install writes its lockfile", () => {
  it("writes this build's lockfile beside cli.mjs", async () => {
    const result = await install("0.13.0");

    expect(result.lockfile).toEqual({
      path: ".taskless/bin/cli.lock.json",
      state: "created",
    });
    const lockfile = JSON.parse(
      await readFile(join(cwd, LOCKFILE), "utf8")
    ) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    expect(lockfile.packages[""]).toEqual({
      dependencies: { "@taskless/cli": __VERSION__ },
    });
    expect(lockfile.packages["node_modules/tsx"]?.integrity).toMatch(
      /^sha512-/
    );
    await expect(
      stat(join(cwd, ".taskless", "bin", "cli-nightly.lock.json"))
    ).rejects.toThrow();
  });

  it("restores an edited lockfile and says so", async () => {
    await install("0.13.0");
    await writeFile(join(cwd, LOCKFILE), "{}\n");

    const result = await install("0.13.0");

    expect(result.lockfile?.state).toBe("restored");
    expect(await readFile(join(cwd, LOCKFILE), "utf8")).toBe(
      __TASKLESS_INSTALL_LOCK__
    );
  });
});

async function cacheEntry(...segments: string[]) {
  const path = join(cwd, CACHE, ...segments);
  await mkdir(path, { recursive: true });
  return path;
}

async function listing(path: string) {
  const entries = await readdir(path);
  return entries.toSorted();
}

describe("an install prunes the launcher cache", () => {
  it("drops the release's previous version and the retired nightly's", async () => {
    await mkdir(join(cwd, ".taskless"));
    await writeInstallState(cwd, {
      cliVersion: "0.13.0",
      launchers: {
        "@taskless/cli": "0.13.0",
        "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234",
      },
      targets: {},
    });
    await cacheEntry("@taskless", "cli@0.13.0");
    await cacheEntry("@taskless", "cli-nightly@0.14.0-20261020120000xabc1234");
    await cacheEntry("@taskless", "cli-nightly@0.13.9-20261001000000xdeadbee");

    await install("0.13.1");

    expect(await listing(join(cwd, CACHE, "@taskless"))).toEqual([]);
  });

  it("removes stale temporary installs and keeps fresh ones", async () => {
    const stale = await cacheEntry(".tmp-1-stale");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    await cacheEntry(".tmp-2-fresh");
    await writeFile(join(cwd, CACHE, ".gitignore"), "*\n");

    await install("0.13.1");

    expect(await listing(join(cwd, CACHE))).toEqual([
      ".gitignore",
      ".tmp-2-fresh",
    ]);
  });

  it("downloads nothing", async () => {
    await install("0.13.1");
    await expect(stat(join(cwd, CACHE))).rejects.toThrow();
  });
});
