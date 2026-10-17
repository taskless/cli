import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GLOBAL_TRUST_ENTRY,
  NIGHTLY_TRUST,
  RELEASE_TRUST,
  syncGlobalTrust,
  type GlobalTrustEnvironment,
} from "../../src/install/global-trust";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedSkills,
} from "../../src/install/install";

/**
 * Under the `nightly` vitest project (see `vite.config.ts`), a nightly owns
 * its own `Taskless CLI nightly:` entry, so testing one beside the release
 * never offers to replace the release's entry, or the reverse.
 */
describe("a nightly's global trust entry", () => {
  let home: string;
  let environment: GlobalTrustEnvironment;
  let settings: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "taskless-nightly-trust-"));
    environment = { home, env: {} };
    settings = join(home, ".claude", "settings.json");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("is the nightly's entry", () => {
    expect(GLOBAL_TRUST_ENTRY).toBe(NIGHTLY_TRUST.entry);
  });

  it("adds its own entry beside the release's, and leaves that one alone", async () => {
    await mkdir(dirname(settings), { recursive: true });
    await writeFile(
      settings,
      JSON.stringify({
        autoMode: { allow: ["$defaults", RELEASE_TRUST.entry] },
      })
    );
    const outcomes = await syncGlobalTrust({
      selected: [".claude"],
      write: true,
      environment,
    });

    expect(outcomes[0]?.state).toBe("written");
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({
      autoMode: {
        allow: ["$defaults", RELEASE_TRUST.entry, NIGHTLY_TRUST.entry],
      },
    });
    const again = await syncGlobalTrust({
      selected: [".claude"],
      write: false,
      environment,
    });
    expect(again[0]?.state).toBe("present");
  });

  it("installs a skill that hands over the nightly's entry", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-nightly-trust-skill-"));
    try {
      await applyInstallPlan(
        cwd,
        buildInstallPlan([".claude"], getEmbeddedSkills()),
        { cliVersion: "0.0.0-nightly.test" }
      );
      const skill = await readFile(
        join(cwd, ".taskless", "skills", "taskless", "SKILL.md"),
        "utf8"
      );
      expect(skill).toContain(`\n${NIGHTLY_TRUST.entry}\n`);
      expect(skill).toContain(
        `in place of any older entry that begins \`${NIGHTLY_TRUST.label}\``
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
