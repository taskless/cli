import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { generateSgConfig } from "../src/filesystem/sgconfig";
import { addToGitignore } from "../src/filesystem/gitignore";

describe("generateSgConfig", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-sgconfig-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("writes sgconfig.yml pointing at the sg engine directory by default", async () => {
    await generateSgConfig(temporaryDirectory);

    const content = await readFile(
      join(temporaryDirectory, ".taskless", "sgconfig.yml"),
      "utf8"
    );
    expect(content).toContain("ruleDirs:");
    expect(content).toContain("- sg/rules");
    expect(content).toContain("testConfigs:");
    expect(content).toContain("testDir: sg/rule-tests");
  });

  it("accepts the legacy layout for an unmigrated rule set", async () => {
    await generateSgConfig(temporaryDirectory, {
      rulesDirectory: "rules",
      testDirectory: "rule-tests",
    });

    const content = await readFile(
      join(temporaryDirectory, ".taskless", "sgconfig.yml"),
      "utf8"
    );
    expect(content).toContain("- rules");
    expect(content).toContain("testDir: rule-tests");
  });

  it("creates .taskless/.gitignore with required entries", async () => {
    await generateSgConfig(temporaryDirectory);

    const gitignore = await readFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "utf8"
    );
    expect(gitignore).toContain(".env.local.json");
    expect(gitignore).toContain("sgconfig.yml");
  });

  it("is idempotent — running twice does not duplicate gitignore entries", async () => {
    await generateSgConfig(temporaryDirectory);
    await generateSgConfig(temporaryDirectory);

    const gitignore = await readFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "utf8"
    );
    const envCount = gitignore
      .split("\n")
      .filter((line) => line.trim() === ".env.local.json").length;
    expect(envCount).toBe(1);
  });
});

describe("addToGitignore", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-gitignore-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates .taskless/.gitignore when .taskless/ does not exist", async () => {
    await addToGitignore(temporaryDirectory, [
      ".env.local.json",
      "sgconfig.yml",
    ]);

    const content = await readFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "utf8"
    );
    expect(content).toContain(".env.local.json");
    expect(content).toContain("sgconfig.yml");
  });

  it("preserves existing entries and appends missing ones", async () => {
    await mkdir(join(temporaryDirectory, ".taskless"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "custom-file.txt\n.env.local.json\n",
      "utf8"
    );

    await addToGitignore(temporaryDirectory, [
      ".env.local.json",
      "sgconfig.yml",
    ]);

    const content = await readFile(
      join(temporaryDirectory, ".taskless", ".gitignore"),
      "utf8"
    );
    expect(content).toContain("custom-file.txt");
    expect(content).toContain(".env.local.json");
    expect(content).toContain("sgconfig.yml");
    // .env.local.json should not be duplicated
    const envCount = content
      .split("\n")
      .filter((line) => line.trim() === ".env.local.json").length;
    expect(envCount).toBe(1);
  });
});
