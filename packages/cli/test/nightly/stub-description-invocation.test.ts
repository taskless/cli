import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSkillStub } from "../../src/install/canonical";
import { parseFrontmatter } from "../../src/install/frontmatter";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedCommands,
  getEmbeddedSkills,
} from "../../src/install/install";
import {
  buildInvocation,
  isProductionInvocation,
} from "../../src/util/invocation";

/**
 * End-to-end companion to `test/stub-description-invocation.test.ts`, run
 * under the `nightly` vitest project (see `vite.config.ts`) so
 * `__TASKLESS_CLI__` is a real pinned `@taskless/cli-nightly@<version>`
 * define, exactly as `build:nightly` produces — not something reachable under
 * this repo's default prod define.
 *
 * taskless/cli#298: a `.claude`/`.agents` stub's frontmatter `description` is
 * copied verbatim from the embedded skill/command source (see `writeSkill` /
 * `writeCommand` in `src/install/install.ts`) and is NEVER passed through
 * `applyCliInvocation` — only a canonical `.taskless/` file gets that rewrite.
 * Before the fix, a description that named the CLI invocation would freeze a
 * stale, unpinned `npx @taskless/cli` reference into every `.claude` stub
 * forever, even though the canonical `.taskless/skills/taskless/SKILL.md`
 * written by the SAME install correctly names this build's pinned nightly.
 *
 * This drives that divergence the way the issue describes it — a real
 * `applyInstallPlan` under a nightly define — without installing the actual
 * `@taskless/cli-nightly` package, which is blocked by a deny rule in this
 * repo.
 */
describe("installing a nightly writes a stub description that names no CLI package", () => {
  let cwd: string;

  beforeEach(async () => {
    expect(isProductionInvocation()).toBe(false);
    expect(buildInvocation()).toContain("@taskless/cli-nightly@");

    cwd = await mkdtemp(join(tmpdir(), "taskless-nightly-stub-description-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: {} }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const skillStubPath = () =>
    join(cwd, ".claude", "skills", "taskless", "SKILL.md");
  const commandStubPath = () =>
    join(cwd, ".claude", "commands", "tskl", "tskl.md");
  const canonicalSkillPath = () =>
    join(cwd, ".taskless", "skills", "taskless", "SKILL.md");

  async function install(): Promise<void> {
    const skills = getEmbeddedSkills();
    const commands = getEmbeddedCommands();
    const plan = buildInstallPlan([".claude"], skills, commands);
    await applyInstallPlan(cwd, plan, { cliVersion: "0.0.0-nightly.test" });
  }

  it("names no CLI package in the stub's frontmatter description", async () => {
    await install();

    const skillDescription = parseFrontmatter(
      await readFile(skillStubPath(), "utf8")
    ).data.description as string;
    const commandDescription = parseFrontmatter(
      await readFile(commandStubPath(), "utf8")
    ).data.description as string;

    // Not the released package, and not this build's own pinned nightly
    // either — the fix is that description names no package at all, so there
    // is nothing left to go stale on a later, differently-pinned install.
    expect(skillDescription).not.toMatch(/@taskless\/cli/);
    expect(commandDescription).not.toMatch(/@taskless\/cli/);
  });

  it("still correctly pins the canonical file's own invocation", async () => {
    await install();

    // Contrast case: the canonical `.taskless/` copy IS rewritten per build,
    // which is what makes the stub's staleness invisible without this test —
    // the canonical file looks completely correct.
    const canonical = await readFile(canonicalSkillPath(), "utf8");
    expect(canonical).toContain(buildInvocation());
    expect(canonical).not.toContain("npx @taskless/cli agent");
  });

  it("a second install under the SAME pin is idempotent: nothing gets rewritten", async () => {
    await install();
    const first = await readFile(skillStubPath(), "utf8");

    // Re-running install (same build, so same pin) must not rewrite a stub
    // whose description never carried a version to begin with. The genuine
    // cross-pin case — an EARLIER, differently pinned install's stub — is
    // covered separately below, since a single compile-time define can't
    // produce two different pins within one test run.
    await install();
    expect(await readFile(skillStubPath(), "utf8")).toBe(first);
  });

  it("a stub frozen by an EARLIER, differently pinned nightly converges on the next install", async () => {
    // Simulates the actual defect in taskless/cli#298: a project installed an
    // older nightly, pinned to a DIFFERENT version, back when a skill's
    // `description` still carried a baked-in CLI invocation. That earlier
    // install's stub is not reachable by calling `install()` twice under this
    // file's single fixed `__TASKLESS_CLI__` define (a compile-time Vite
    // define can't vary within one test run), so it is hand-crafted here with
    // `buildSkillStub` instead — the same builder `writeSkill` itself calls,
    // fed the OLD-style description a pre-fix source file would have produced.
    await mkdir(dirname(skillStubPath()), { recursive: true });
    const frozenByEarlierNightly = buildSkillStub({
      name: "taskless",
      description:
        "Use for any Taskless task. Fetch recipes via " +
        "`npx @taskless/cli-nightly@0.0.0-nightly.previous agent route`.",
    });
    await writeFile(skillStubPath(), frozenByEarlierNightly, "utf8");

    await install();

    const rewritten = await readFile(skillStubPath(), "utf8");
    const rewrittenDescription = parseFrontmatter(rewritten).data
      .description as string;

    // The stub actually changed — this build's install converged it rather
    // than leaving the earlier nightly's frozen copy in place.
    expect(rewritten).not.toBe(frozenByEarlierNightly);
    // It converged onto the CURRENT source description (invocation-free), not
    // merely onto some other pin.
    const currentDescription = getEmbeddedSkills().find(
      (s) => s.name === "taskless"
    )?.description;
    expect(rewrittenDescription).toBe(currentDescription);
    // And, the property the whole fix establishes: no pinned or unpinned CLI
    // package reference survives, from either the old install or this one.
    expect(rewrittenDescription).not.toMatch(/@taskless\/cli/);
  });
});
