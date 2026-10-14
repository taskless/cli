import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import migration from "../src/filesystem/migrations/0011-reports-directory";

/**
 * Migration 0011 creates `.taskless/reports/` and ignores it, because each
 * record there holds the URL that deletes a published report.
 */
describe("migration 0011 creates and ignores the reports directory", () => {
  let directory: string;
  let taskless: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-0011-"));
    taskless = join(directory, ".taskless");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function gitignoreLines(): Promise<string[]> {
    const content = await readFile(join(taskless, ".gitignore"), "utf8");
    return content.split("\n").filter(Boolean);
  }

  it("upgrades a version-10 scaffold", async () => {
    await mkdir(taskless, { recursive: true });
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 10, install: {} }),
      "utf8"
    );
    await writeFile(
      join(taskless, ".gitignore"),
      ".env.local.json\n/sgconfig.yml\n/.tmp-*\n",
      "utf8"
    );

    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    expect(await gitignoreLines()).toContain("/reports/");
    await expect(
      readFile(join(taskless, "reports", "README.md"), "utf8")
    ).resolves.toContain("taskless report --delete");
    const manifest = JSON.parse(
      await readFile(join(taskless, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
  });

  it("leaves a fresh scaffold in the same state", async () => {
    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    expect(await gitignoreLines()).toContain("/reports/");
    await expect(
      readFile(join(taskless, "reports", "README.md"), "utf8")
    ).resolves.toBeTypeOf("string");
  });

  it("is idempotent and leaves existing records alone", async () => {
    await mkdir(join(taskless, "reports"), { recursive: true });
    const record = join(taskless, "reports", "2026-10-13_142200.json");
    await writeFile(record, '{"url":"u","deleteUrl":"d"}\n', "utf8");
    await writeFile(join(taskless, "reports", "README.md"), "edited\n", "utf8");
    await writeFile(join(taskless, ".gitignore"), "/reports/\n", "utf8");

    await migration(taskless);
    await migration(taskless);

    const lines = await gitignoreLines();
    expect(lines.filter((line) => line === "/reports/")).toHaveLength(1);
    await expect(readFile(record, "utf8")).resolves.toBe(
      '{"url":"u","deleteUrl":"d"}\n'
    );
    await expect(
      readFile(join(taskless, "reports", "README.md"), "utf8")
    ).resolves.toBe("edited\n");
  });

  it("keeps a record out of git", async () => {
    await ensureTasklessDirectory(directory, { onNotice: () => {} });
    await writeFile(
      join(taskless, "reports", "2026-10-13_142200.json"),
      "{}",
      "utf8"
    );

    const run = promisify(execFile);
    await run("git", ["init", "-q"], { cwd: directory });
    const { stdout } = await run(
      "git",
      ["check-ignore", ".taskless/reports/2026-10-13_142200.json"],
      { cwd: directory }
    );
    expect(stdout.trim()).toBe(".taskless/reports/2026-10-13_142200.json");
  });
});
