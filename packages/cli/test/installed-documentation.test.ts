import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildReadmeContent } from "../src/filesystem/migrations/0001-init";
import { pinnedSpecifier } from "../src/util/package-manager";

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
