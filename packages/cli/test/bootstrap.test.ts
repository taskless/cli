import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  stat,
  cp,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";

const v0Fixture = resolve(import.meta.dirname, "fixtures/v0-production");

describe("ensureTasklessDirectory", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-bootstrap-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates .taskless/ with all standard files on first run", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const tasklessDirectory = join(temporaryDirectory, ".taskless");

    // taskless.json exists with version
    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBeGreaterThan(0);

    // README.md exists
    const readme = await readFile(join(tasklessDirectory, "README.md"), "utf8");
    expect(readme).toContain("Taskless");
    expect(readme).toContain("taskless.io");

    // .gitignore has required entries
    const gitignore = await readFile(
      join(tasklessDirectory, ".gitignore"),
      "utf8"
    );
    expect(gitignore).toContain(".env.local.json");
    expect(gitignore).toContain("sgconfig.yml");

    // Engine-partitioned subdirectories exist (migration 0004)
    const rulesStat = await stat(join(tasklessDirectory, "rules", "sg"));
    expect(rulesStat.isDirectory()).toBe(true);
    const testsStat = await stat(join(tasklessDirectory, "rules", "sg"));
    expect(testsStat.isDirectory()).toBe(true);
  });

  it("is a no-op when already up-to-date", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    const manifestBefore = await readFile(
      join(tasklessDirectory, "taskless.json"),
      "utf8"
    );
    const readmeBefore = await readFile(
      join(tasklessDirectory, "README.md"),
      "utf8"
    );

    // Run again
    await ensureTasklessDirectory(temporaryDirectory);

    const manifestAfter = await readFile(
      join(tasklessDirectory, "taskless.json"),
      "utf8"
    );
    const readmeAfter = await readFile(
      join(tasklessDirectory, "README.md"),
      "utf8"
    );

    expect(manifestAfter).toBe(manifestBefore);
    expect(readmeAfter).toBe(readmeBefore);
  });

  it("runs only new migrations when version is outdated", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    // Write a manifest at version 0 (no migrations run yet)
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 0 }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    // Should have run migrations and updated version
    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBeGreaterThan(0);

    // Files from 001-init should exist
    const readmeStat = await stat(join(tasklessDirectory, "README.md"));
    expect(readmeStat.isFile()).toBe(true);
    const rulesStat = await stat(join(tasklessDirectory, "rules", "sg"));
    expect(rulesStat.isDirectory()).toBe(true);
  });

  it("recovers from a corrupt taskless.json manifest", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    // Write corrupt JSON that would cause "unexpected token *"
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      "***not-json***",
      "utf8"
    );

    // Should not throw — treats corrupt manifest as version 0
    await ensureTasklessDirectory(temporaryDirectory);

    // Manifest should be rewritten with a valid version
    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBeGreaterThan(0);
  });

  it("is idempotent — re-running after completion succeeds without errors", async () => {
    await ensureTasklessDirectory(temporaryDirectory);
    await ensureTasklessDirectory(temporaryDirectory);
    await ensureTasklessDirectory(temporaryDirectory);

    // Should not throw and files should still be intact
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBeGreaterThan(0);
  });

  it("overwrites README.md with current content", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    // Write stale README
    await writeFile(
      join(tasklessDirectory, "README.md"),
      "# Old content\n",
      "utf8"
    );
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 0 }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const readme = await readFile(join(tasklessDirectory, "README.md"), "utf8");
    expect(readme).toContain("taskless.io");
    expect(readme).not.toContain("Old content");
  });
});

describe("v0 → v1 migration", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-v0-migrate-"));
    await cp(v0Fixture, temporaryDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("migrates v0 taskless.json to integer version", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(
        join(temporaryDirectory, ".taskless", "taskless.json"),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(typeof manifest.version).toBe("number");
    expect(manifest.version).toBeGreaterThan(0);
    // Old fields should be gone
    expect(manifest).not.toHaveProperty("orgId");
    expect(manifest).not.toHaveProperty("repositoryUrl");
    expect(manifest).not.toHaveProperty("astGrepVersion");
  });

  it("overwrites stale README.md from v0", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const readme = await readFile(
      join(temporaryDirectory, ".taskless", "README.md"),
      "utf8"
    );
    // New README mentions rule-tests
    expect(readme).toContain("rule-tests");
    // New README mentions .env.local.json
    expect(readme).toContain(".env.local.json");
  });

  it("creates .gitignore that was missing in v0", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const gitignore = await readFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "utf8"
    );
    expect(gitignore).toContain(".env.local.json");
    expect(gitignore).toContain("sgconfig.yml");
  });

  it("preserves existing rule files", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const ruleContent = await readFile(
      join(temporaryDirectory, ".taskless", "rules", "sg", "no-as-any", "no-as-any.yml"),
      "utf8"
    );
    expect(ruleContent).toContain("no-as-any");
    expect(ruleContent).toContain("as any");
  });

  it("preserves existing test files", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const testContent = await readFile(
      join(
        temporaryDirectory,
        ".taskless",
        "rules",
        "sg",
        "no-as-any",
        ".tests",
        "no-as-any-20260326-test.yml"
      ),
      "utf8"
    );
    expect(testContent).toContain("no-as-any");
    expect(testContent).toContain("valid");
    expect(testContent).toContain("invalid");
  });

  it("preserves .gitkeep files", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const keepStat = await stat(
      join(temporaryDirectory, ".taskless", "rules", "vale", ".gitkeep")
    );
    expect(keepStat.isFile()).toBe(true);
  });

  it("is idempotent on migrated v0 directory", async () => {
    await ensureTasklessDirectory(temporaryDirectory);
    const manifestBefore = await readFile(
      join(temporaryDirectory, ".taskless", "taskless.json"),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);
    const manifestAfter = await readFile(
      join(temporaryDirectory, ".taskless", "taskless.json"),
      "utf8"
    );

    expect(manifestAfter).toBe(manifestBefore);
  });
});
