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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedSkills,
} from "../../src/install/install";
import { renderLauncher } from "../../src/install/launcher";
import { readInstallState, writeInstallState } from "../../src/install/state";
import { getCliVersion } from "../../src/wizard/intro";

/**
 * Runs under the `nightly` vitest project, whose build target is `nightly`.
 * The release's launcher and the nightly's must never touch each other, and a
 * prod define cannot express the nightly side of that.
 */

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-install-launcher-nightly-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const RELEASE_LAUNCHER = join(".taskless", "bin", "cli.mjs");
const NIGHTLY_LAUNCHER = join(".taskless", "bin", "cli-nightly.mjs");
const RELEASE_LOCKFILE = join(".taskless", "bin", "cli.lock.json");
const NIGHTLY_LOCKFILE = join(".taskless", "bin", "cli-nightly.lock.json");

describe("a nightly install beside the release", () => {
  it("writes only cli-nightly.mjs and keeps the release's launcher and version", async () => {
    await mkdir(join(cwd, ".taskless", "bin"), { recursive: true });
    const release = renderLauncher("@taskless/cli");
    await writeFile(join(cwd, RELEASE_LAUNCHER), release);
    await writeInstallState(cwd, {
      cliVersion: "0.13.0",
      launchers: { "@taskless/cli": "0.13.0" },
      targets: {},
    });

    const version = getCliVersion();
    const result = await applyInstallPlan(
      cwd,
      buildInstallPlan([".claude"], getEmbeddedSkills()),
      { cliVersion: version }
    );

    expect(result.launcher).toEqual({
      path: ".taskless/bin/cli-nightly.mjs",
      state: "created",
    });
    expect(await readFile(join(cwd, RELEASE_LAUNCHER), "utf8")).toBe(release);
    expect(await readFile(join(cwd, NIGHTLY_LAUNCHER), "utf8")).toBe(
      renderLauncher("@taskless/cli-nightly")
    );
    const { mode } = await stat(join(cwd, NIGHTLY_LAUNCHER));
    expect(mode & 0o111).not.toBe(0);

    const state = await readInstallState(cwd);
    expect(state.launchers).toEqual({
      "@taskless/cli": "0.13.0",
      "@taskless/cli-nightly": version,
    });
    expect(state.cliVersion).toBe(version);
  });

  it("names its own launcher in the installed skill", async () => {
    await applyInstallPlan(
      cwd,
      buildInstallPlan([".claude"], getEmbeddedSkills()),
      { cliVersion: getCliVersion() }
    );
    const skill = await readFile(
      join(cwd, ".taskless", "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("./.taskless/bin/cli-nightly.mjs agent");
    expect(skill).not.toContain("./.taskless/bin/cli.mjs");
  });
});

describe("a nightly install's lockfile", () => {
  it("writes cli-nightly.lock.json and leaves the release's lockfile alone", async () => {
    await mkdir(join(cwd, ".taskless", "bin"), { recursive: true });
    await writeFile(join(cwd, RELEASE_LOCKFILE), "release lockfile\n");

    const result = await applyInstallPlan(
      cwd,
      buildInstallPlan([".claude"], getEmbeddedSkills()),
      { cliVersion: getCliVersion() }
    );

    expect(result.lockfile).toEqual({
      path: ".taskless/bin/cli-nightly.lock.json",
      state: "created",
    });
    const lockfile = JSON.parse(
      await readFile(join(cwd, NIGHTLY_LOCKFILE), "utf8")
    ) as { packages: Record<string, { resolved?: string }> };
    expect(
      lockfile.packages["node_modules/@taskless/cli-nightly"]?.resolved
    ).toContain("/@taskless/cli-nightly/-/cli-nightly-");
    expect(await readFile(join(cwd, RELEASE_LOCKFILE), "utf8")).toBe(
      "release lockfile\n"
    );
  });
});
