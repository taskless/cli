import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseFrontmatter } from "../../src/install/frontmatter";
import {
  applyInstallPlan,
  buildInstallPlan,
  checkStaleness,
  getEmbeddedCommands,
  getEmbeddedSkills,
} from "../../src/install/install";
import { CLI_VERSION } from "../../src/version";

/**
 * taskless/cli#447, under the `nightly` vitest project (see `vite.config.ts`),
 * where `__VERSION__` is a nightly version rather than the committed package
 * version the skill source carries. A nightly `init` rewrote the canonical
 * skill's body to pin itself but left `metadata.version` at the last release,
 * and `info` compared that stale stamp against the same stale stamp.
 */
describe("installing a nightly stamps the skill with the nightly's version", () => {
  let cwd: string;

  beforeEach(async () => {
    expect(CLI_VERSION).toBe("0.0.0-nightly.test");

    cwd = await mkdtemp(join(tmpdir(), "taskless-nightly-skill-version-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await mkdir(join(cwd, ".claude"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: {} }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function install(): Promise<void> {
    const plan = buildInstallPlan(
      [".claude"],
      getEmbeddedSkills(),
      getEmbeddedCommands()
    );
    await applyInstallPlan(cwd, plan, { cliVersion: CLI_VERSION });
  }

  it("writes metadata.version as the running build", async () => {
    await install();

    const canonical = await readFile(
      join(cwd, ".taskless", "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    const metadata = parseFrontmatter(canonical).data.metadata as Record<
      string,
      string
    >;
    expect(metadata.version).toBe(CLI_VERSION);
  });

  it("reports both sides of the staleness check as the running build", async () => {
    await install();

    const [tool] = await checkStaleness(cwd);
    expect(tool?.skills.length).toBeGreaterThan(0);
    for (const skill of tool!.skills) {
      expect(skill.installedVersion).toBe(CLI_VERSION);
      expect(skill.currentVersion).toBe(CLI_VERSION);
      expect(skill.current).toBe(true);
    }
  });

  it("reports a skill a release wrote as stale", async () => {
    await install();
    const path = join(cwd, ".taskless", "skills", "taskless", "SKILL.md");
    const canonical = await readFile(path, "utf8");
    await writeFile(
      path,
      canonical.replace(`version: ${CLI_VERSION}`, "version: 0.11.2"),
      "utf8"
    );

    const [tool] = await checkStaleness(cwd);
    const skill = tool!.skills.find((s) => s.name === "taskless");
    expect(skill?.installedVersion).toBe("0.11.2");
    expect(skill?.current).toBe(false);
  });
});
