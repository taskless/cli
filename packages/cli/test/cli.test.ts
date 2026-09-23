import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

describe("cli", () => {
  it("has a shebang in the built output", async () => {
    const content = await readFile(binPath, "utf8");
    expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  describe("info", () => {
    it("outputs version, harnesses and tools as JSON", async () => {
      const { stdout } = await execFileAsync("node", [
        binPath,
        "info",
        "--json",
      ]);
      const parsed = JSON.parse(stdout.trim()) as {
        version: string;
        harnesses: unknown[];
        tools: Array<{ name: string; present: boolean; applicable: boolean }>;
      };
      expect(parsed).toHaveProperty("version");
      expect(typeof parsed.version).toBe("string");
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
      // The agent harnesses. This array was published as `tools` until that
      // word was needed for what it says; the entry shape did not change.
      expect(parsed).toHaveProperty("harnesses");
      expect(Array.isArray(parsed.harnesses)).toBe(true);
      // `tools` now carries the command-line binaries found on PATH.
      expect(Array.isArray(parsed.tools)).toBe(true);
      expect(parsed.tools.map((tool) => tool.name)).toEqual([
        "gh",
        "git",
        "jq",
      ]);
      // `git` is how this test suite got here, so it is a safe assertion
      // about a real host rather than about a fixture.
      const git = parsed.tools.find((tool) => tool.name === "git");
      expect(git).toMatchObject({ present: true, applicable: true });
    });
  });

  describe("no args", () => {
    it("shows the agent topic index and exits with code 0", async () => {
      const { stdout } = await execFileAsync("node", [binPath]);
      expect(stdout).toContain("taskless");
      expect(stdout).toContain("info");
      expect(stdout).toContain("init");
      expect(stdout).not.toContain("update-engine");
    });
  });

  describe("init", () => {
    let temporaryDirectory: string;

    beforeEach(async () => {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-test-"));
    });

    afterEach(async () => {
      await rm(temporaryDirectory, { recursive: true, force: true });
    });

    it("uses .agents fallback when no tool directories exist", async () => {
      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "-d",
        temporaryDirectory,
      ]);
      expect(stdout).toContain("No tools detected. Using fallback: .agents/");
      expect(stdout).toContain("Agent Skills (.agents/)");
    });

    it("installs skills when .claude/ directory exists", async () => {
      await mkdir(join(temporaryDirectory, ".claude"), { recursive: true });

      const { stdout } = await execFileAsync("node", [
        binPath,
        "init",
        "-d",
        temporaryDirectory,
      ]);
      expect(stdout).toContain("Claude Code");

      const skillContent = await readFile(
        join(temporaryDirectory, ".claude", "skills", "taskless", "SKILL.md"),
        "utf8"
      );
      expect(skillContent).toContain("name: taskless");

      const commandContent = await readFile(
        join(temporaryDirectory, ".claude", "commands", "tskl", "tskl.md"),
        "utf8"
      );
      expect(commandContent).toContain("Taskless");
    });

    it("reports staleness via info after install", async () => {
      await mkdir(join(temporaryDirectory, ".claude"), { recursive: true });

      // Install first
      await execFileAsync("node", [binPath, "init", "-d", temporaryDirectory]);

      // Check info
      const { stdout } = await execFileAsync("node", [
        binPath,
        "info",
        "--json",
        "-d",
        temporaryDirectory,
      ]);
      const parsed = JSON.parse(stdout.trim()) as {
        version: string;
        harnesses: Array<{
          name: string;
          skills: Array<{ name: string; current: boolean }>;
        }>;
      };

      expect(parsed.harnesses.length).toBeGreaterThan(0);
      const claudeTool = parsed.harnesses.find((t) => t.name === "Claude Code");
      expect(claudeTool).toBeDefined();
      expect(claudeTool!.skills[0]!.current).toBe(true);
    });
  });
});
