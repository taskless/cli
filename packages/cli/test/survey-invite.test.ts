import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRecipe } from "../src/prompts/recipes";
import { nextAskPath, readNextAsk, writeNextAsk } from "../src/survey/cadence";
import { SHOWN_INTERVAL_MS, SURVEY_ID } from "../src/survey/constants";
import { getTelemetry } from "../src/telemetry";

// Spy on telemetry by mocking the module the gate imports, the same way
// agent-telemetry.test.ts does. `enabled` flips per test so the opt-out branch
// is exercised without touching the environment the real client reads.
const capture = vi.fn();
let enabled = true;
vi.mock("../src/telemetry", () => ({
  getTelemetry: vi.fn(() =>
    Promise.resolve({ capture, shutdown: () => Promise.resolve() })
  ),
  isTelemetryEnabled: () => enabled,
  shutdownTelemetry: () => Promise.resolve(),
}));

const { surveyGateIsOpen, withSurveyInvite } =
  await import("../src/survey/invite");
const { createAgentCommand } = await import("../src/commands/agent");
const { onboardCommand } = await import("../src/commands/onboard");

const invocation = "npx @taskless/cli";
const NOW = 1_800_000_000_000;

/** The exact fragment the gate appends, rendered the way the gate renders it. */
function inviteFragment(): string {
  return (
    getRecipe("feedback-invite", { invocation, header: false }) ?? ""
  ).trimEnd();
}

interface RunnableCommand {
  run: (context: {
    args: Record<string, unknown>;
    rawArgs: string[];
  }) => Promise<void>;
}

describe("the survey gate", () => {
  let cwd: string;
  let configHome: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-invite-cwd-"));
    configHome = await mkdtemp(join(tmpdir(), "tskl-invite-config-"));
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    vi.stubEnv("CI", "");
    enabled = true;
    capture.mockClear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  });

  function serve(topic: string, overrides: { ci?: string } = {}) {
    const recipe = getRecipe(topic, { invocation, directive: true }) ?? "";
    return withSurveyInvite({
      recipe,
      topic,
      invocation,
      cwd,
      ci: overrides.ci,
      now: () => NOW,
    });
  }

  it("appends the invite, captures survey shown, and writes the cadence when open", async () => {
    const recipe =
      getRecipe("create-sg-rule", { invocation, directive: true }) ?? "";
    const served = await serve("create-sg-rule");

    expect(served).toBe(`${recipe.trimEnd()}\n\n${inviteFragment()}`);
    // The appended text carries no second header: it is a fragment.
    expect(served.match(/^# Topic:/gm)).toHaveLength(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("survey shown", {
      $survey_id: SURVEY_ID,
    });
    expect(await readNextAsk(SURVEY_ID)).toBe(NOW + SHOWN_INTERVAL_MS);
  });

  it("claims the cadence window before the telemetry client is initialised", async () => {
    // The mocked client reads the cadence file at the moment the gate asks
    // for it, so the assertion is about ordering, not the final state.
    let seenAtTelemetryInit: number | undefined;
    vi.mocked(getTelemetry).mockImplementationOnce(async () => {
      seenAtTelemetryInit = await readNextAsk(SURVEY_ID);
      return { capture, shutdown: () => Promise.resolve() };
    });

    await serve("create-sg-rule");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(seenAtTelemetryInit).toBe(NOW + SHOWN_INTERVAL_MS);
  });

  it.each([
    "onboard",
    "create-sg-rule",
    "create-vale-rule",
    "create-remote-rule",
  ])("surveys %s", async (topic) => {
    expect(await surveyGateIsOpen({ topic, now: () => NOW })).toBe(true);
  });

  it("serves the bare recipe within the window, touching nothing", async () => {
    await writeNextAsk(SURVEY_ID, NOW + 1);
    const recipe =
      getRecipe("create-vale-rule", { invocation, directive: true }) ?? "";

    expect(await serve("create-vale-rule")).toBe(recipe.trimEnd());
    expect(capture).not.toHaveBeenCalled();
    expect(await readNextAsk(SURVEY_ID)).toBe(NOW + 1);
  });

  it("opens the moment the window closes", async () => {
    await writeNextAsk(SURVEY_ID, NOW);
    expect(await surveyGateIsOpen({ topic: "onboard", now: () => NOW })).toBe(
      true
    );
  });

  it("serves the bare recipe under the telemetry opt-out, without reading the cadence", async () => {
    enabled = false;
    // A cadence that says "ask now" would open the gate if it were read.
    await writeNextAsk(SURVEY_ID, 0);
    const recipe =
      getRecipe("create-sg-rule", { invocation, directive: true }) ?? "";

    expect(await serve("create-sg-rule")).toBe(recipe.trimEnd());
    expect(capture).not.toHaveBeenCalled();
    expect(await readNextAsk(SURVEY_ID)).toBe(0);
  });

  it.each(["true", "1"])("serves the bare recipe in CI (CI=%s)", async (ci) => {
    const recipe = getRecipe("onboard", { invocation, directive: true }) ?? "";
    expect(await serve("onboard", { ci })).toBe(recipe.trimEnd());
    expect(capture).not.toHaveBeenCalled();
    expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
  });

  it("serves an unsurveyed topic bare and leaves the cadence alone", async () => {
    const recipe = getRecipe("check", { invocation, directive: true }) ?? "";
    expect(await serve("check")).toBe(recipe.trimEnd());
    expect(capture).not.toHaveBeenCalled();
    expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
  });

  it("repairs a corrupt cadence file by serving and rewriting", async () => {
    const path = nextAskPath(SURVEY_ID);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "garbage", "utf8");

    const served = await serve("create-remote-rule");
    expect(served.endsWith(inviteFragment())).toBe(true);
    expect(await readNextAsk(SURVEY_ID)).toBe(NOW + SHOWN_INTERVAL_MS);
  });

  /** Everything the command wrote to stdout, as one string. */
  function printed(): string {
    return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
  }

  describe("through the serving commands", () => {
    it("agent <surveyed topic> carries the invite after cli_agent", async () => {
      const command = createAgentCommand({}) as unknown as RunnableCommand;
      await command.run({
        args: { dir: cwd, anonymous: false },
        rawArgs: ["agent", "create-sg-rule"],
      });

      expect(printed()).toContain("## Before you finish");
      expect(capture.mock.calls.map(([event]) => String(event))).toEqual([
        "cli_agent",
        "survey shown",
      ]);
    });

    it("agent <unsurveyed topic> does not", async () => {
      const command = createAgentCommand({}) as unknown as RunnableCommand;
      await command.run({
        args: { dir: cwd, anonymous: false },
        rawArgs: ["agent", "check"],
      });
      expect(printed()).not.toContain("## Before you finish");
      expect(capture.mock.calls.map(([event]) => String(event))).toEqual([
        "cli_agent",
      ]);
    });

    it("taskless onboard carries the invite on the recipe path", async () => {
      const command = onboardCommand as unknown as RunnableCommand;
      await command.run({
        args: { dir: cwd, force: false, "mark-complete": false },
        rawArgs: [],
      });
      expect(printed()).toContain("# Topic: onboard");
      expect(printed()).toContain("## Before you finish");
      expect(capture).toHaveBeenCalledWith("survey shown", {
        $survey_id: SURVEY_ID,
      });
    });

    it("taskless onboard --mark-complete does not", async () => {
      const command = onboardCommand as unknown as RunnableCommand;
      await command.run({
        args: { dir: cwd, force: false, "mark-complete": true },
        rawArgs: [],
      });
      expect(printed()).not.toContain("## Before you finish");
      expect(capture.mock.calls.map(([event]) => String(event))).toEqual([
        "cli_onboarded",
      ]);
    });

    it("an already-onboarded project without --force does not", async () => {
      const command = onboardCommand as unknown as RunnableCommand;
      await command.run({
        args: { dir: cwd, force: false, "mark-complete": true },
        rawArgs: [],
      });
      capture.mockClear();
      logSpy.mockClear();
      await command.run({
        args: { dir: cwd, force: false, "mark-complete": false },
        rawArgs: [],
      });
      expect(printed()).not.toContain("## Before you finish");
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
