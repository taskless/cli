import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readNextAsk } from "../src/survey/cadence";
import { ANSWERED_INTERVAL_MS, SURVEY_ID } from "../src/survey/constants";
import { CLIError } from "../src/util/cli-error";

// Spy on telemetry by mocking the module the command imports, the same way
// agent-telemetry.test.ts does. `enabled` is flipped per test to exercise the
// opt-out path without touching the environment the client reads.
const capture = vi.fn();
let enabled = true;
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture, shutdown: () => Promise.resolve() })
  ),
  isTelemetryEnabled: () => enabled,
  shutdownTelemetry: () => Promise.resolve(),
}));

const { feedbackCommand, buildSurveyResponse } =
  await import("../src/commands/feedback");

interface RunnableCommand {
  run: (context: {
    args: Record<string, unknown>;
    rawArgs: string[];
  }) => Promise<void>;
}

function verb(name: "dismiss" | "send"): RunnableCommand {
  const subCommands = feedbackCommand.subCommands as Record<string, unknown>;
  return subCommands[name] as RunnableCommand;
}

const VALID = {
  verbatim: "The second rule took three tries but the verify loop caught it.",
  goal: "Forbid eval in TypeScript",
  completed: "Yes",
  needsImprovement: "The first draft used a language name ast-grep rejects.",
};

describe("feedback command", () => {
  let cwd: string;
  let configHome: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-feedback-cwd-"));
    configHome = await mkdtemp(join(tmpdir(), "tskl-feedback-config-"));
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    enabled = true;
    capture.mockClear();
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    await rm(cwd, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  });

  async function writePayload(payload: unknown): Promise<string> {
    const path = join(cwd, ".tmp-feedback.json");
    await writeFile(path, JSON.stringify(payload), "utf8");
    return path;
  }

  describe("dismiss", () => {
    it("captures survey dismissed with the survey id and nothing else", async () => {
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith("survey dismissed", {
        $survey_id: SURVEY_ID,
      });
    });

    it("holds the next invite off by the answered interval", async () => {
      const before = Date.now();
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      const nextAsk = await readNextAsk(SURVEY_ID);
      expect(nextAsk).toBeGreaterThanOrEqual(before + ANSWERED_INTERVAL_MS);
      expect(nextAsk).toBeLessThanOrEqual(Date.now() + ANSWERED_INTERVAL_MS);
    });

    it("sends nothing under the opt-out, and says so with exit 0", async () => {
      enabled = false;
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      expect(capture).not.toHaveBeenCalled();
      expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
      expect(process.exitCode).toBeUndefined();
      expect(logSpy.mock.calls.flat().join("\n")).toMatch(/disabled/);
    });
  });

  describe("send", () => {
    it("captures survey sent as exactly PostHog's keys", async () => {
      const from = await writePayload(VALID);
      await verb("send").run({
        args: { dir: cwd, from, json: false },
        rawArgs: [],
      });

      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith("survey sent", {
        $survey_id: SURVEY_ID,
        "$survey_response_5feff6a3-6768-4817-92d7-5ae3975c6baa": VALID.verbatim,
        "$survey_response_561e87f4-a1b7-4855-b728-29d19421f7e7": VALID.goal,
        "$survey_response_6ebdfabb-3575-49aa-857c-47b6bbfdebc8": "Yes",
        "$survey_response_67bedbd9-ca70-4c1c-b1a6-6df830a453dd":
          VALID.needsImprovement,
      });
      // The unanswered optional (`workedWell`) has no key at all.
      const properties = capture.mock.calls[0]![1] as Record<string, unknown>;
      expect(Object.keys(properties)).toHaveLength(5);
    });

    it("leaves the input file in place and creates no .taskless/", async () => {
      const from = await writePayload(VALID);
      await verb("send").run({
        args: { dir: cwd, from, json: false },
        rawArgs: [],
      });
      expect(await readFile(from, "utf8")).toBe(JSON.stringify(VALID));
      expect(await readdir(cwd)).toEqual([".tmp-feedback.json"]);
    });

    it("holds the next invite off by the answered interval", async () => {
      const from = await writePayload(VALID);
      const before = Date.now();
      await verb("send").run({
        args: { dir: cwd, from, json: false },
        rawArgs: [],
      });
      expect(await readNextAsk(SURVEY_ID)).toBeGreaterThanOrEqual(
        before + ANSWERED_INTERVAL_MS
      );
    });

    it("rejects an invalid payload with INVALID_INPUT naming the field, sending nothing", async () => {
      const from = await writePayload({ ...VALID, completed: "partially" });
      await expect(
        verb("send").run({ args: { dir: cwd, from, json: false }, rawArgs: [] })
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof CLIError && error.code === "INVALID_INPUT"
      );
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("completed");
      expect(capture).not.toHaveBeenCalled();
      expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
      expect(process.exitCode).toBe(1);
    });

    it("rejects a missing --from", async () => {
      await expect(
        verb("send").run({ args: { dir: cwd, json: false }, rawArgs: [] })
      ).rejects.toBeInstanceOf(CLIError);
      expect(capture).not.toHaveBeenCalled();
    });

    it("rejects an unreadable file and invalid JSON", async () => {
      await expect(
        verb("send").run({
          args: { dir: cwd, from: "missing.json", json: false },
          rawArgs: [],
        })
      ).rejects.toBeInstanceOf(CLIError);
      const from = join(cwd, "bad.json");
      await writeFile(from, "{", "utf8");
      await expect(
        verb("send").run({ args: { dir: cwd, from, json: false }, rawArgs: [] })
      ).rejects.toBeInstanceOf(CLIError);
      expect(capture).not.toHaveBeenCalled();
    });

    it("validates before honoring the opt-out, then sends nothing", async () => {
      enabled = false;
      const bad = await writePayload({ goal: "x" });
      await expect(
        verb("send").run({
          args: { dir: cwd, from: bad, json: false },
          rawArgs: [],
        })
      ).rejects.toBeInstanceOf(CLIError);

      process.exitCode = undefined;
      const good = await writePayload(VALID);
      await verb("send").run({
        args: { dir: cwd, from: good, json: false },
        rawArgs: [],
      });
      expect(capture).not.toHaveBeenCalled();
      expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("buildSurveyResponse", () => {
    it("maps every answered key and no unanswered one", () => {
      const properties = buildSurveyResponse({
        verbatim: "v",
        goal: "g",
        completed: "Unknown",
      });
      expect(properties).toEqual({
        $survey_id: SURVEY_ID,
        "$survey_response_5feff6a3-6768-4817-92d7-5ae3975c6baa": "v",
        "$survey_response_561e87f4-a1b7-4855-b728-29d19421f7e7": "g",
        "$survey_response_6ebdfabb-3575-49aa-857c-47b6bbfdebc8": "Unknown",
      });
    });
  });
});

describe("feedback in the built CLI", () => {
  const execFileAsync = promisify(execFile);
  const binPath = resolve(import.meta.dirname, "../dist/index.js");

  it("is absent from the agent index", async () => {
    const { stdout } = await execFileAsync("node", [binPath, "agent"]);
    expect(stdout).toContain("Topics:");
    expect(stdout).not.toMatch(/^\s*feedback\b/m);
  });

  it("still serves --help with both verbs", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "feedback",
      "--help",
    ]);
    expect(stdout).toContain("dismiss");
    expect(stdout).toContain("send");
  });

  it("emits the JSON error envelope for a missing --from", async () => {
    const failure = await execFileAsync("node", [
      binPath,
      "feedback",
      "send",
      "--json",
    ]).then(
      () => {},
      (error: { stdout: string; code: number }) => error
    );
    expect(failure?.code).toBe(1);
    const envelope = JSON.parse(failure?.stdout ?? "") as {
      ok: boolean;
      code: string;
    };
    expect(envelope).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
