import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import { readNextAsk, writeNextAsk } from "../src/survey/cadence";
import {
  ANSWERED_INTERVAL_MS,
  RULE_SURVEY_ID,
  SURVEYS,
} from "../src/survey/constants";
import { CLIError } from "../src/util/cli-error";
import { builtCli } from "./support/built-cli";

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

const { feedbackCommand, buildSurveyResponse, ISSUES_URL } =
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
  kind: "rule",
  ruleKind: "ast-grep, forbid eval in TypeScript",
  verbatim: "The second rule took three tries but the verify loop caught it.",
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

  async function send(payload: unknown): Promise<Record<string, string>> {
    const from = await writePayload(payload);
    await verb("send").run({
      args: { dir: cwd, from, json: false },
      rawArgs: [],
    });
    expect(capture).toHaveBeenCalledTimes(1);
    return capture.mock.calls[0]![1] as Record<string, string>;
  }

  describe("dismiss", () => {
    it("captures survey dismissed with the survey id and nothing else", async () => {
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith("survey dismissed", {
        $survey_id: RULE_SURVEY_ID,
      });
    });

    it("holds the next invite off by the answered interval", async () => {
      const before = Date.now();
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      const nextAsk = await readNextAsk(RULE_SURVEY_ID);
      expect(nextAsk).toBeGreaterThanOrEqual(before + ANSWERED_INTERVAL_MS);
      expect(nextAsk).toBeLessThanOrEqual(Date.now() + ANSWERED_INTERVAL_MS);
    });

    it("sends nothing under the opt-out, and says so with exit 0", async () => {
      enabled = false;
      await verb("dismiss").run({ args: { dir: cwd }, rawArgs: [] });
      expect(capture).not.toHaveBeenCalled();
      expect(await readNextAsk(RULE_SURVEY_ID)).toBeUndefined();
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
        $survey_id: RULE_SURVEY_ID,
        "$survey_response_0874591f-c554-4ac3-8930-e11c436d859e": VALID.ruleKind,
        "$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2": VALID.verbatim,
        "$survey_response_605e12a8-82b6-480f-93b2-ab8de0fa08bd": "Yes",
        "$survey_response_a8cf706d-3ff7-4845-bea9-501013be958c":
          VALID.needsImprovement,
      });
      // The unanswered optionals have no key at all.
      const properties = capture.mock.calls[0]![1] as Record<string, unknown>;
      expect(Object.keys(properties)).toHaveLength(5);
    });

    it("sends the agent's account alone when the user gave no words", async () => {
      // A `skip` reply is not a dismissal: the payload omits `verbatim` and
      // the rest still goes, keyed to the survey's required question.
      const from = await writePayload({
        kind: "rule",
        ruleKind: "none (onboarding)",
      });
      await verb("send").run({
        args: { dir: cwd, from, json: false },
        rawArgs: [],
      });
      expect(capture).toHaveBeenCalledWith("survey sent", {
        $survey_id: RULE_SURVEY_ID,
        "$survey_response_0874591f-c554-4ac3-8930-e11c436d859e":
          "none (onboarding)",
      });
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
      expect(await readNextAsk(RULE_SURVEY_ID)).toBeGreaterThanOrEqual(
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
      expect(await readNextAsk(RULE_SURVEY_ID)).toBeUndefined();
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
      const bad = await writePayload({ verbatim: "x" });
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
      expect(await readNextAsk(RULE_SURVEY_ID)).toBeUndefined();
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("send, by kind", () => {
    const GENERAL = { kind: "general", verbatim: "The recipes are long." };
    const BUG = {
      kind: "bug",
      summary: "check exits 0 when a rule file fails to parse",
      trying: "Run taskless check after adding a rule",
      expected: "A non-zero exit naming the broken rule",
      actual: "Exit 0 with no findings",
    };
    const VERSION_QUESTION = `$survey_response_${
      SURVEYS.bug.questions.find(({ key }) => key === undefined)!.id
    }`;

    it.each([
      ["rule", VALID, "01a0c7b9-dfe4-0000-d05e-ce253e90a68c"],
      ["general", GENERAL, "01a11da4-3948-0000-4ae4-c9da9321801e"],
      ["bug", BUG, "01a11da7-27a2-0000-0f4e-6d3e1f89f385"],
    ])("sends a %s payload to its own survey", async (_kind, payload, id) => {
      const properties = await send(payload);
      expect(properties.$survey_id).toBe(id);
    });

    it.each([
      ["general", GENERAL],
      ["bug", BUG],
    ])("leaves the cadence alone for a %s payload", async (kind, payload) => {
      await writeNextAsk(RULE_SURVEY_ID, 1234);
      await send(payload);
      expect(await readNextAsk(RULE_SURVEY_ID)).toBe(1234);
      expect(
        await readNextAsk(SURVEYS[kind as "general" | "bug"].id)
      ).toBeUndefined();
    });

    it("answers a bug report's version information itself", async () => {
      await mkdir(join(cwd, ".taskless"), { recursive: true });
      await writeFile(
        join(cwd, ".taskless", "taskless.json"),
        JSON.stringify({
          version: LATEST_SCHEMA_VERSION,
          install: { cliVersion: "0.11.3" },
          rules: { reconciledTo: "0.11.0" },
        }),
        "utf8"
      );
      const properties = await send(BUG);
      const answer = properties[VERSION_QUESTION]!;
      expect(answer).toMatch(/^cli: \S+/);
      expect(answer).toContain("installed scaffold: 0.11.3");
      expect(answer).toContain("rules reconciled to: 0.11.0");
      expect(answer).toContain(`platform: ${process.platform} ${process.arch}`);
      expect(answer).toContain(`node: ${process.version}`);
    });

    it("still answers it with no .taskless/, and says nothing identifying", async () => {
      const properties = await send(BUG);
      const answer = properties[VERSION_QUESTION]!;
      // Every line is one of the four local facts and nothing else: no
      // login, email, organization, repository URL, or path.
      expect(
        answer.split("\n").map((line) => line.slice(0, line.indexOf(":")))
      ).toEqual(["cli", "platform", "node"]);
      expect(answer).not.toContain(cwd);
    });

    it("gives no other kind a version-information answer", async () => {
      const properties = await send(GENERAL);
      expect(Object.keys(properties)).not.toContain(VERSION_QUESTION);
    });

    it.each([
      ["rule", VALID],
      ["general", GENERAL],
      ["bug", BUG],
    ])(
      "under the opt-out sends no %s payload and names the issues page",
      async (_kind, payload) => {
        enabled = false;
        const from = await writePayload(payload);
        await verb("send").run({
          args: { dir: cwd, from, json: false },
          rawArgs: [],
        });
        expect(capture).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toMatch(/disabled/);
        expect(printed).toContain(ISSUES_URL);
        expect(ISSUES_URL).toBe("https://github.com/taskless/cli/issues");
      }
    );

    it("rejects a payload with no kind, naming kind", async () => {
      const { kind: _kind, ...rest } = VALID;
      const from = await writePayload(rest);
      await expect(
        verb("send").run({ args: { dir: cwd, from, json: false }, rawArgs: [] })
      ).rejects.toBeInstanceOf(CLIError);
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("kind");
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("buildSurveyResponse", () => {
    it("maps every answered key and no unanswered one", () => {
      const properties = buildSurveyResponse({
        kind: "rule",
        ruleKind: "r",
        verbatim: "v",
        completed: "Unknown",
        agents: "Claude Code",
      });
      expect(properties).toEqual({
        $survey_id: RULE_SURVEY_ID,
        "$survey_response_0874591f-c554-4ac3-8930-e11c436d859e": "r",
        "$survey_response_2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2": "v",
        "$survey_response_605e12a8-82b6-480f-93b2-ab8de0fa08bd": "Unknown",
        "$survey_response_f85b22df-8e51-4c9c-8219-261b33b71c90": "Claude Code",
      });
    });

    it("maps a general payload to the general survey", () => {
      expect(
        buildSurveyResponse({ kind: "general", verbatim: "v", context: "c" })
      ).toEqual({
        $survey_id: "01a11da4-3948-0000-4ae4-c9da9321801e",
        "$survey_response_c71e52ee-f4c7-469f-815a-af50a9be6d37": "v",
        "$survey_response_ab0ceb25-8084-44c8-9974-1d1a1c7371c2": "c",
      });
    });

    it("maps a bug payload to the bug survey", () => {
      expect(
        buildSurveyResponse({
          kind: "bug",
          summary: "s",
          trying: "t",
          expected: "e",
          actual: "a",
        })
      ).toEqual({
        $survey_id: "01a11da7-27a2-0000-0f4e-6d3e1f89f385",
        "$survey_response_2dd63cf3-dac2-4765-ace0-393bc4aa42fe": "s",
        "$survey_response_e59a87e9-9ac7-4a59-a709-a282b16dbf37": "t",
        "$survey_response_73415b80-7371-4536-8c50-09c2ecaa5d52": "e",
        "$survey_response_daa98d8d-113e-4e3e-ac0f-595ecc1fc69f": "a",
      });
    });
  });
});

describe("feedback in the built CLI", () => {
  const execFileAsync = promisify(execFile);
  const binPath = builtCli();

  it("lists the user-initiated recipes, and only them, in the agent index", async () => {
    const { stdout } = await execFileAsync("node", [binPath, "agent"]);
    const topics = stdout.slice(0, stdout.indexOf("Authoring recipes:"));
    const feedback = stdout.slice(stdout.indexOf("Feedback recipes:"));
    // The command is reached through a recipe, never listed as a command.
    expect(topics).toContain("Topics:");
    expect(topics).not.toMatch(/^\s*feedback\b/m);
    expect(feedback).toMatch(/^\s*feedback\s/m);
    expect(feedback).toMatch(/^\s*bug-report\s/m);
    // The invited survey is reached through the invite alone.
    expect(stdout).not.toContain("rule-feedback");
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
