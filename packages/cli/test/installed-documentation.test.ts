import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildReadmeContent } from "../src/filesystem/migrations/0001-init";
import { readmeSpecifier } from "../src/util/package-manager";
import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedSkills,
} from "../src/install/install";
import { buildInvocation } from "../src/util/invocation";
import {
  ENGINES,
  RULES_DIRECTORY,
  RULE_TESTS_DIRECTORY,
} from "../src/rules/layout";

/**
 * This repository runs Taskless on itself, so its own `.taskless/` is an
 * installed project like any other, and it went stale exactly the way a user's
 * would: the README described `sg/rules/` and `rule-tests/` for two migrations
 * after `0004` and `0005` dismantled that tree.
 *
 * WHAT LET IT SIT THERE was that nothing compared the file on disk to what the
 * current build would write. Changing the template is a source edit; refreshing
 * an already-migrated project is a separate act that nobody was reminded to
 * perform, and `runMigrations` returns early on a current project so it never
 * happened by itself.
 *
 * This is the reminder. It is deliberately about OUR copy rather than about the
 * generator: asserting that a generated file matches its own generator would be
 * vacuous. The question worth asking is whether the installed artifact in this
 * repository is the one this build produces.
 */

const repositoryRoot = resolve(import.meta.dirname, "../../..");

/** The README an older CLI left behind, naming the pre-`0004` tree. */
const STALE_README = `# Taskless

## Files

- \`rules/\` - Generated ast-grep rules (managed by Taskless)
- \`rule-tests/\` - Rule tests containing pass/fail examples for your rules
`;

describe("migration 0006, on a project that is already current", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-0006-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("rewrites a stale README that no other migration would touch", async () => {
    // The bug, reproduced exactly. `runMigrations` returns early once the
    // recorded version is current, so a project that reached 5 never ran
    // `0001` again and kept whatever README it was handed — forever. Nothing
    // below its own version can reach it, which is why this needed a version
    // of its own rather than a corrected template.
    const taskless = join(directory, ".taskless");
    await mkdir(taskless, { recursive: true });
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 5, install: {} }),
      "utf8"
    );
    await writeFile(join(taskless, "README.md"), STALE_README, "utf8");

    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    const readme = await readFile(join(taskless, "README.md"), "utf8");
    expect(readme).not.toContain("rule-tests");
    for (const engine of ENGINES) {
      expect(readme, `${engine} is described`).toContain(
        `${RULES_DIRECTORY}/${engine}/<id>/`
      );
    }
    expect(readme).toContain(`${RULE_TESTS_DIRECTORY}/`);

    const manifest = JSON.parse(
      await readFile(join(taskless, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe("this repository's own installed Taskless docs", () => {
  it("carries the README this build would write", async () => {
    const onDisk = await readFile(
      resolve(repositoryRoot, ".taskless", "README.md"),
      "utf8"
    );

    // If this fails, the template changed and this project was not migrated.
    // Run `pnpm build && pnpm cli init` and commit the result;
    // do not edit `.taskless/README.md` by hand, since the next migration
    // overwrites it.
    expect(onDisk).toBe(buildReadmeContent(readmeSpecifier()));
  });

  it("describes no directory the layout migrations removed", async () => {
    // The specific stale words, named so a reintroduction is caught by what it
    // says rather than only by a whole-file comparison. `rule-tests/` is the
    // directory `0005` deletes.
    const onDisk = await readFile(
      resolve(repositoryRoot, ".taskless", "README.md"),
      "utf8"
    );
    expect(onDisk).not.toContain("rule-tests");
    expect(onDisk).not.toContain("sg/rules/");
  });

  it("spells the CLI as %(TASKLESS_CLI)s in the skill source, never the literal", async () => {
    // The canonical write used to find `npx @taskless/cli` in the prose and
    // rewrite it for nightly/dev builds. A literal is whitespace-sensitive: a
    // wrapped line or a doubled space escaped the rewrite silently, and a
    // nightly install then told its agent to run the release package. The
    // token either matches exactly or this test says it is missing.
    const source = await readFile(
      resolve(repositoryRoot, "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    const body = source.replace(/^---\n[\s\S]*?\n---\n/, "");
    expect(body).toContain("%(TASKLESS_CLI)s");
    expect(body).not.toContain("npx @taskless/cli");
  });

  it("renders the placeholder to this build's invocation at install, and nothing else", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "taskless-placeholder-"));
    try {
      await applyInstallPlan(
        cwd,
        buildInstallPlan([".claude"], getEmbeddedSkills()),
        { cliVersion: "0.0.0-test" }
      );
      for (const relative of [
        join(".taskless", "skills", "taskless", "SKILL.md"),
      ]) {
        const installed = await readFile(join(cwd, relative), "utf8");
        expect(installed, relative).toContain(`${buildInvocation()} agent`);
        expect(installed, relative).not.toContain("%(");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("tells an agent a recipe is per-task", async () => {
    // A recipe is resolved at fetch time. Without this an agent that fetched
    // `agent check` once reuses the text for every later task in the session,
    // including after the upgrade that changed it.
    const skill = await readFile(
      resolve(repositoryRoot, "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("resolved when it is fetched");
    expect(skill).toContain("earlier in this session");
  });

  it("preflights the CLI and scopes a blocked one to the exact invocation", async () => {
    // A harness may refuse a download-and-run command. Without a preflight
    // the refusal lands on the first command that does work, after any
    // consent question that lives inside a recipe. And an agent left to pick
    // its own remedy proposed `npx @taskless/cli-nightly:*`, approving every
    // future nightly rather than the one installed.
    const skill = await readFile(
      resolve(repositoryRoot, "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    // Compared as prose, so where a line happens to wrap does not matter.
    const prose = skill.replaceAll(/\s+/g, " ");
    expect(prose).toContain("%(TASKLESS_CLI)s agent ok");
    expect(prose).toContain("before any other Taskless command");
    expect(prose).toContain(
      "allow rule for exactly the invocation `%(TASKLESS_CLI)s`"
    );
    // Auto mode refused the agent's own settings write; it then handed the
    // user a command that made the change, and that worked.
    expect(prose).toContain("give the user the change to make themselves");
    expect(prose).toContain("`/permissions`");
    expect(prose).toContain("`Bash(%(TASKLESS_CLI)s *)`");
    // A harness like Crush can only allow all of `bash`, far wider than one
    // invocation.
    expect(prose).toContain("offer only per-command approval");
    expect(prose).toContain(
      "approve every Taskless command manually, here in chat"
    );
    // `!` runs the preflight once and leaves every later command blocked.
    expect(prose).not.toContain("! <exact command>");
    expect(prose).toContain("wildcard over the package name");
    // Asking "what next?" while blocked, then again once unblocked, put two
    // extra questions in front of onboarding's one.
    expect(prose).toContain("Do not ask what they want Taskless to do");
    expect(prose).toContain("no menu");
    // "let's use taskless" names no task, and onboarding's question is the
    // one that matters.
    expect(prose).toContain("do not offer a menu of topics first");
  });

  it("keeps the skill body within its 150-line cap", async () => {
    // `skill-taskless` caps the body at 150 lines of markdown. The cap guards
    // against unbounded growth, not against guidance the router needs: when
    // the body needs the room, raise the cap rather than compress the text.
    // Counted the way a reader would, every line after the closing `---`,
    // blank lines included.
    const skill = await readFile(
      resolve(repositoryRoot, "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    const body = skill.replace(/^---\n[\s\S]*?\n---\n/, "").trimEnd();
    expect(body.split("\n").length).toBeLessThanOrEqual(150);
  });

  it("keeps the skill's trigger text off the old layout too", async () => {
    // The skill description is what an agent reads before it opens anything, so
    // a stale directory name here sends it looking in a place that no longer
    // exists. Checked at the SOURCE, which is what `init` installs from.
    const skill = await readFile(
      resolve(repositoryRoot, "skills", "taskless", "SKILL.md"),
      "utf8"
    );
    expect(skill).not.toContain("rule-tests");
  });
});
