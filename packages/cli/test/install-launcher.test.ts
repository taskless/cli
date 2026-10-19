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

  it("keeps the nightly's recorded version", async () => {
    await mkdir(join(cwd, ".taskless"));
    await writeInstallState(cwd, {
      cliVersion: "0.14.0-20261020120000xabc1234",
      launchers: { "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" },
      targets: {},
    });

    await install("0.13.0");

    const { launchers } = await readInstallState(cwd);
    expect(launchers).toEqual({
      "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234",
      "@taskless/cli": "0.13.0",
    });
  });

  it("names the launcher in the installed skill", async () => {
    await install("0.13.0");
    const skill = await readFile(join(cwd, SKILL), "utf8");
    expect(skill).toContain("./.taskless/bin/cli.mjs agent");
    expect(skill).toContain("the directory that contains `.taskless/`");
  });
});
