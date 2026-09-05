import { execFile } from "node:child_process";
import { writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { outputSchema as createOutputSchema } from "../src/schemas/rules-create";
import { outputSchema as improveOutputSchema } from "../src/schemas/rules-improve";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

describe("rules create --from", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-test-"));
    // Create a minimal .taskless/taskless.json so readProjectConfig succeeds
    await mkdir(join(temporaryDirectory, ".taskless"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".taskless", "taskless.json"),
      JSON.stringify({
        version: "2026-03-03",
        orgId: 123,
        repositoryUrl: "https://github.com/test/test",
      })
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("errors when --from is not provided", async () => {
    try {
      await execFileAsync("node", [
        binPath,
        "rule",
        "create",
        "-d",
        temporaryDirectory,
      ]);
      expect.fail("should have exited with non-zero code");
    } catch (error) {
      const execError = error as { stderr: string; code: number };
      expect(execError.stderr || execError.code).toBeTruthy();
    }
  });

  it("errors when --from file does not exist", async () => {
    try {
      await execFileAsync("node", [
        binPath,
        "rule",
        "create",
        "--from",
        "nonexistent.json",
        "-d",
        temporaryDirectory,
      ]);
      expect.fail("should have exited with non-zero code");
    } catch (error) {
      const execError = error as { stderr: string };
      expect(execError.stderr).toContain("Could not read file");
    }
  });

  it("errors when --from file contains invalid JSON", async () => {
    const badFile = join(temporaryDirectory, "bad.json");
    await writeFile(badFile, "not json at all");

    try {
      await execFileAsync("node", [
        binPath,
        "rule",
        "create",
        "--from",
        badFile,
        "-d",
        temporaryDirectory,
      ]);
      expect.fail("should have exited with non-zero code");
    } catch (error) {
      const execError = error as { stderr: string };
      expect(execError.stderr).toContain("not valid JSON");
    }
  });

  it("errors when --from file is missing the prompt field", async () => {
    const noPromptFile = join(temporaryDirectory, "no-prompt.json");
    await writeFile(noPromptFile, JSON.stringify({ language: "typescript" }));

    try {
      await execFileAsync("node", [
        binPath,
        "rule",
        "create",
        "--from",
        noPromptFile,
        "-d",
        temporaryDirectory,
      ]);
      expect.fail("should have exited with non-zero code");
    } catch (error) {
      const execError = error as { stderr: string };
      expect(execError.stderr).toContain("Invalid input");
    }
  });
});

describe("the create and improve --json envelopes carry delivery notices", () => {
  const CREATE = { success: true, ruleId: "req-1", rules: ["a"], files: ["f"] };
  const IMPROVE = {
    success: true,
    requestId: "req-1",
    rules: ["a"],
    files: ["f"],
  };

  // The claim that makes this additive rather than a breaking change: every
  // payload that parsed before still parses, so a consumer reading the four
  // original fields is unaffected.
  it("still accepts a payload with no notices at all", () => {
    expect(createOutputSchema.parse(CREATE).notices).toBeUndefined();
    expect(improveOutputSchema.parse(IMPROVE).notices).toBeUndefined();
  });

  // And the field survives the parse, which is the whole point: a fixture-less
  // delivery is invisible to a `--json` caller unless the envelope carries it,
  // and that caller is the one most likely to act on it unattended.
  it("carries notices through to the parsed output", () => {
    const notice = 'Rule "a" was delivered with no .tests/ fixtures';
    expect(
      createOutputSchema.parse({ ...CREATE, notices: [notice] }).notices
    ).toEqual([notice]);
    expect(
      improveOutputSchema.parse({ ...IMPROVE, notices: [notice] }).notices
    ).toEqual([notice]);
  });
});
