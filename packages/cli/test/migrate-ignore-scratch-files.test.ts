import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import migration from "../src/filesystem/migrations/0007-ignore-scratch-files";

/**
 * Migration 0007 adds `/.tmp-*` to `.taskless/.gitignore`.
 *
 * `migrate-install.test.ts` proves every prior version reaches the latest
 * counter; it never reads `.gitignore`, so a 0007 that stopped writing the
 * line would pass there. This file reads the line.
 */
describe("migration 0007 ignores scratch request files", () => {
  let directory: string;
  let taskless: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-0007-"));
    taskless = join(directory, ".taskless");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function gitignoreLines(): Promise<string[]> {
    const content = await readFile(join(taskless, ".gitignore"), "utf8");
    return content.split("\n").filter(Boolean);
  }

  it("adds the line to a version-6 scaffold and records 7", async () => {
    await mkdir(taskless, { recursive: true });
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 6, install: {} }),
      "utf8"
    );
    // What 0001 and 0004 leave behind on a current project.
    await writeFile(
      join(taskless, ".gitignore"),
      ".env.local.json\n/sgconfig.yml\n",
      "utf8"
    );

    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    const lines = await gitignoreLines();
    expect(lines).toContain("/.tmp-*");
    // The existing entries survive: the helper appends, it does not rewrite.
    expect(lines).toContain(".env.local.json");
    expect(lines).toContain("/sgconfig.yml");

    const manifest = JSON.parse(
      await readFile(join(taskless, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(7);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
  });

  it("leaves a fresh scaffold with the same file", async () => {
    // No `.taskless/` at all: migrations 1 through 7 run in order. The point
    // is that 0001 is unchanged and the fresh path still ends here.
    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    const lines = await gitignoreLines();
    expect(lines).toEqual(
      expect.arrayContaining([".env.local.json", "/sgconfig.yml", "/.tmp-*"])
    );
  });

  it("is idempotent", async () => {
    await mkdir(taskless, { recursive: true });
    await writeFile(join(taskless, ".gitignore"), "/.tmp-*\n", "utf8");

    await migration(taskless);
    await migration(taskless);

    const lines = await gitignoreLines();
    expect(lines.filter((line) => line === "/.tmp-*")).toHaveLength(1);
  });

  it("makes a forgotten scratch file invisible to git", async () => {
    await ensureTasklessDirectory(directory, { onNotice: () => {} });
    await writeFile(join(taskless, ".tmp-feedback.json"), "{}", "utf8");

    // `git check-ignore` reads the nested `.taskless/.gitignore` the same way
    // `git status` does, so this asks git rather than re-deriving its rules.
    const run = promisify(execFile);
    await run("git", ["init", "-q"], { cwd: directory });
    const { stdout } = await run(
      "git",
      ["check-ignore", ".taskless/.tmp-feedback.json"],
      { cwd: directory }
    );
    expect(stdout.trim()).toBe(".taskless/.tmp-feedback.json");
  });
});
