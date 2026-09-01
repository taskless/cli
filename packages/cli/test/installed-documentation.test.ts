import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildReadmeContent } from "../src/filesystem/migrations/0001-init";
import { pinnedSpecifier } from "../src/util/package-manager";
import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
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
    // Run `pnpm build && pnpm cli init --no-interactive` and commit the result;
    // do not edit `.taskless/README.md` by hand, since the next migration
    // overwrites it.
    expect(onDisk).toBe(buildReadmeContent(pinnedSpecifier()));
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
