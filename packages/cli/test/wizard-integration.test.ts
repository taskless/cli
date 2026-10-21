import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureSpy = vi.fn();
// Flipped per test so the notice can be checked under both opt-out states.
let telemetryEnabled = true;
vi.mock("../src/telemetry", () => ({
  getTelemetry: () =>
    Promise.resolve({ capture: captureSpy, shutdown: () => Promise.resolve() }),
  isTelemetryEnabled: () => Promise.resolve(telemetryEnabled),
  // The wording is asserted in telemetry.test.ts; here only that it is shown.
  TELEMETRY_NOTICE: "<telemetry notice>",
  TELEMETRY_NOTICE_TITLE: "<telemetry title>",
  shutdownTelemetry: () => Promise.resolve(),
}));

const fakeCancelSymbol = Symbol("cancel");

// Records what closed the clack frame, so a test can tell "the message was
// shown inside the frame" from "it escaped past a frame nothing closed".
const cancelSpy = vi.fn();
// Records how the frame closed on a run that finished.
const outroSpy = vi.fn();

// Clack mock responses are set per-test via these mutable refs.
const clackResponses: {
  /** Checked row values: harness names, or `agents` for the generic row. */
  locations?: string[] | symbol;
  summary?: boolean | symbol;
  commit?: string | symbol;
  commitMessage?: string | symbol;
} = {};

// Every select the wizard asked, in order.
const selectMessages: string[] = [];

// Every confirm the wizard asked, in order.
const confirmMessages: string[] = [];

// Captures the message of the summary confirm prompt for assertions.
let summaryConfirmMessage: string | undefined;

// Everything the wizard showed through `log.message`, in order.
const loggedMessages: string[] = [];
// Everything it warned through `log.warn`.
const warnedMessages: string[] = [];
// Everything it said through `log.info`.
const infoMessages: string[] = [];

vi.mock("@clack/prompts", () => ({
  intro: () => {},
  outro: (message?: string) => {
    outroSpy(message);
  },
  cancel: (message?: string) => {
    cancelSpy(message);
  },
  log: {
    info: (message: string) => {
      infoMessages.push(message);
    },
    message: (message: string) => {
      loggedMessages.push(message);
    },
    error: () => {},
    warn: (message: string) => {
      warnedMessages.push(message);
    },
    success: () => {},
  },
  note: () => {},
  isCancel: (value: unknown) => value === fakeCancelSymbol,
  groupMultiselect: vi.fn(() => Promise.resolve(clackResponses.locations)),
  select: vi.fn(({ message }: { message: string }) => {
    selectMessages.push(message);
    return Promise.resolve(clackResponses.commit);
  }),
  text: vi.fn(() => Promise.resolve(clackResponses.commitMessage)),
  confirm: vi.fn(({ message }: { message: string }) => {
    confirmMessages.push(message);
    summaryConfirmMessage = message;
    return Promise.resolve(clackResponses.summary);
  }),
}));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

let cwd: string;
// A home of its own for every test, so no run reads or writes the real
// `~/.claude/settings.json`.
let globalTrustEnvironment: { home: string; env: Record<string, string> };

function userSettings(): string {
  return join(globalTrustEnvironment.home, ".claude", "settings.json");
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-wizard-e2e-"));
  globalTrustEnvironment = {
    home: await mkdtemp(join(tmpdir(), "taskless-wizard-home-")),
    env: {},
  };
  await mkdir(join(cwd, ".claude"), { recursive: true });
  captureSpy.mockClear();
  cancelSpy.mockClear();
  outroSpy.mockClear();
  clackResponses.locations = undefined;
  clackResponses.summary = undefined;
  clackResponses.commit = undefined;
  clackResponses.commitMessage = undefined;
  selectMessages.length = 0;
  confirmMessages.length = 0;
  summaryConfirmMessage = undefined;
  loggedMessages.length = 0;
  warnedMessages.length = 0;
  infoMessages.length = 0;
  telemetryEnabled = true;
  vi.stubEnv("TASKLESS_TOKEN", "stub-token");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(cwd, { recursive: true, force: true });
  await rm(globalTrustEnvironment.home, { recursive: true, force: true });
  vi.resetModules();
});

describe("runWizard end-to-end", () => {
  it("installs all bundled skills to selected location and records manifest", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    expect(result.locations).toEqual([".claude"]);
    expect(result.optionalSkills).toEqual([]);

    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as {
      version: number;
      install: { targets: Record<string, { skills: string[] }> };
    };
    expect(manifest.install.targets[".claude"]?.skills).toContain("taskless");

    expect(captureSpy).toHaveBeenCalledWith("cli_installed");
  });

  it("completes without a token and never offers to log in", async () => {
    vi.stubEnv("TASKLESS_TOKEN", "");
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const clack = await import("@clack/prompts");
    const confirmMock = vi.mocked(clack.confirm);
    confirmMock.mockClear();

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    const messages = confirmMock.mock.calls.map(([options]) =>
      String(options.message)
    );
    expect(messages.filter((m) => /log\s*in/i.test(m))).toEqual([]);
  });

  it("says once that it collects telemetry, and how to opt out", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    expect(
      infoMessages.filter((m) => m === "<telemetry title>\n<telemetry notice>")
    ).toHaveLength(1);
  });

  it("says nothing about telemetry when it is already off", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;
    telemetryEnabled = false;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    expect(infoMessages.join("\n")).not.toContain("<telemetry notice>");
  });

  it("re-running with the same location is idempotent", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });
    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);

    // Re-run with the same selection — no diff, should complete cleanly.
    await runWizard({ cwd, globalTrustEnvironment });
    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("cancelling at locations step writes nothing and emits no install event", async () => {
    clackResponses.locations = fakeCancelSymbol;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("cancelled");
    expect(result.cancelledStep).toBe("locations");

    expect(await exists(join(cwd, ".claude", "skills", "taskless"))).toBe(
      false
    );
    expect(await exists(join(cwd, ".taskless", "taskless.json"))).toBe(false);

    // A cancelled wizard installs nothing, so it emits no cli_installed event;
    // the invocation itself is captured by cli_run at the runner level. Assert
    // on the event name across all calls so extra properties can't slip past.
    const events = captureSpy.mock.calls.map((call) => call[0] as string);
    expect(events).not.toContain("cli_installed");
  });

  it("shows the permission edit before writing, and asks", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = false;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    // A fresh install removes nothing, so the confirm is there only because
    // a settings file would be edited.
    expect(summaryConfirmMessage).toBe("Make these changes to your settings?");
    const summary = loggedMessages.join("\n");
    expect(summary).toMatch(
      /ALLOW \(project\): npx @taskless\/cli@\S+\n {17}in \.claude\/settings\.json/
    );
    expect(result.status).toBe("cancelled");
    expect(await exists(join(cwd, ".claude", "settings.json"))).toBe(false);
  });

  it("previews removing a Taskless rule it never recorded", async () => {
    // A stale rule an agent added through the skill's fallback.
    const stale = "Bash(npx @taskless/cli@0.12.0 *)";
    await writeFile(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: [stale] } })
    );
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = false;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    const summary = loggedMessages.join("\n");
    // REMOVE is the widest label, so ALLOW pads to meet it.
    expect(summary).toContain(
      "REMOVE (project): npx @taskless/cli@0.12.0\n" +
        "                  in .claude/settings.json"
    );
    expect(summary).toMatch(/ALLOW \(project\): {2}npx @taskless\/cli@/);
    const settings = summary.slice(summary.indexOf("Agent settings"));
    for (const line of settings.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  describe("global trust", () => {
    it("lists project and global edits together under one question", async () => {
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = true;

      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });

      const summary = loggedMessages.join("\n");
      // Labels padded to the widest, statements in one column, the file on
      // its own line beneath, and nothing past 76 columns.
      expect(summary).toMatch(
        /ALLOW \(project\): npx @taskless\/cli@\S+\n {17}in \.claude\/settings\.json/
      );
      expect(summary).toContain(
        "ALLOW (global):  @taskless/cli at an exact version\n" +
          "                 in ~/.claude/settings.json (autoMode.allow)"
      );
      expect(confirmMessages).toEqual(["Make these changes to your settings?"]);
      const settings = JSON.parse(await readFile(userSettings(), "utf8")) as {
        autoMode: { allow: string[] };
      };
      expect(settings.autoMode.allow[0]).toBe("$defaults");
      expect(settings.autoMode.allow[1]).toMatch(/^Taskless CLI:/);
      expect(warnedMessages).toEqual([]);
    });

    it("declining writes neither the project nor the global settings", async () => {
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = false;

      const { runWizard } = await import("../src/wizard");
      const result = await runWizard({ cwd, globalTrustEnvironment });

      expect(result.status).toBe("cancelled");
      expect(await exists(userSettings())).toBe(false);
      expect(await exists(join(cwd, ".claude", "settings.json"))).toBe(false);
    });

    it("asks again on the next run after a decline", async () => {
      // Nothing records the answer: an absent entry is offered every time.
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = false;

      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });
      await runWizard({ cwd, globalTrustEnvironment });

      expect(
        loggedMessages.filter((message) => message.includes("ALLOW (global)"))
      ).toHaveLength(2);
    });

    it("asks about the global entry alone when the project is current", async () => {
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = true;
      const { runWizard } = await import("../src/wizard");
      // A first run with no home settings writes both; remove the global one.
      await runWizard({ cwd, globalTrustEnvironment });
      await rm(userSettings());
      confirmMessages.length = 0;
      loggedMessages.length = 0;

      await runWizard({ cwd, globalTrustEnvironment });

      const summary = loggedMessages.join("\n");
      expect(summary).not.toContain("ALLOW (project)");
      expect(summary).toContain("ALLOW (global)");
      expect(confirmMessages).toEqual(["Make these changes to your settings?"]);
    });

    it("does not offer an entry that is already there", async () => {
      const { GLOBAL_TRUST_ENTRY } =
        await import("../src/install/global-trust");
      await mkdir(dirname(userSettings()), { recursive: true });
      const original = JSON.stringify({
        autoMode: { allow: ["$defaults", GLOBAL_TRUST_ENTRY] },
      });
      await writeFile(userSettings(), original);
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = true;

      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });

      expect(loggedMessages.join("\n")).not.toContain("(global)");
      expect(await readFile(userSettings(), "utf8")).toBe(original);
    });

    it("replaces a stale entry where it sits once confirmed", async () => {
      const { GLOBAL_TRUST_ENTRY } =
        await import("../src/install/global-trust");
      await mkdir(dirname(userSettings()), { recursive: true });
      await writeFile(
        userSettings(),
        JSON.stringify({
          autoMode: {
            allow: [
              "$defaults",
              "Taskless CLI: mine",
              "Internal Registry: ours",
            ],
          },
        })
      );
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = true;

      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });

      expect(loggedMessages.join("\n")).toContain(
        "REPLACE (global): @taskless/cli at an exact version\n" +
          "                  in ~/.claude/settings.json (autoMode.allow)"
      );
      expect(confirmMessages).toEqual(["Make these changes to your settings?"]);
      const settings = JSON.parse(await readFile(userSettings(), "utf8")) as {
        autoMode: { allow: string[] };
      };
      expect(settings.autoMode.allow).toEqual([
        "$defaults",
        GLOBAL_TRUST_ENTRY,
        "Internal Registry: ours",
      ]);
      expect(warnedMessages).toEqual([]);
    });

    it("declining leaves a stale entry byte-identical", async () => {
      await mkdir(dirname(userSettings()), { recursive: true });
      const original = JSON.stringify({
        autoMode: { allow: ["$defaults", "Taskless CLI: mine"] },
      });
      await writeFile(userSettings(), original);
      clackResponses.locations = ["Claude Code"];
      clackResponses.summary = false;

      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });

      expect(await readFile(userSettings(), "utf8")).toBe(original);
    });
  });

  it("writes the permission rule once confirmed", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    const settings = JSON.parse(
      await readFile(join(cwd, ".claude", "settings.json"), "utf8")
    ) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toEqual([
      expect.stringMatching(/^Bash\(npx @taskless\/cli@\S+ \*\)$/),
      "Bash(./.taskless/bin/cli.mjs *)",
    ]);
  });

  it("cancelling the summary confirm writes nothing", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = false;

    // Seed install state with a stale skill name that is no longer in the
    // bundle so the next wizard run computes a removal and shows the
    // summary confirm. We don't actually need the file on disk — the diff
    // computation reads the manifest, not the filesystem.
    const { ensureTasklessDirectory } =
      await import("../src/filesystem/directory");
    await ensureTasklessDirectory(cwd);
    const { writeInstallState } = await import("../src/install/state");
    await writeInstallState(cwd, {
      cliVersion: "0.5.4",
      targets: {
        ".claude": {
          skills: ["taskless-removed-fixture-skill"],
          commands: [],
        },
      },
    });

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });
    expect(result.status).toBe("cancelled");
    expect(result.cancelledStep).toBe("summary");
  });

  it("unchecking a previously-installed location removes its stubs", async () => {
    const { runWizard } = await import("../src/wizard");

    // First run: install Taskless into both .claude/ and .agents/.
    clackResponses.locations = ["Claude Code", "agents"];
    clackResponses.summary = true;
    await runWizard({ cwd, globalTrustEnvironment });

    const claudeSkill = join(cwd, ".claude", "skills", "taskless", "SKILL.md");
    const agentsSkill = join(cwd, ".agents", "skills", "taskless", "SKILL.md");
    expect(await exists(claudeSkill)).toBe(true);
    expect(await exists(agentsSkill)).toBe(true);

    // Second run: uncheck .claude/, keep .agents/ — consolidating onto .agents.
    summaryConfirmMessage = undefined;
    clackResponses.locations = ["agents"];
    clackResponses.summary = true;
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    // The .claude/ stub is removed; the .agents/ stub is retained.
    expect(await exists(claudeSkill)).toBe(false);
    expect(await exists(agentsSkill)).toBe(true);

    // The removal confirmation is itemized for the unchecked location.
    expect(summaryConfirmMessage).toBeDefined();
    expect(summaryConfirmMessage).toContain("Remove Taskless from");
    expect(summaryConfirmMessage).toContain(".claude/");
    expect(summaryConfirmMessage).not.toContain(".agents/");

    // The manifest no longer records the .claude/ target.
    const manifest = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { install: { targets: Record<string, unknown> } };
    expect(manifest.install.targets[".claude"]).toBeUndefined();
    expect(manifest.install.targets[".agents"]).toBeDefined();
  });

  it("declining the removal confirm keeps the unchecked location's stubs", async () => {
    const { runWizard } = await import("../src/wizard");

    clackResponses.locations = ["Claude Code", "agents"];
    clackResponses.summary = true;
    await runWizard({ cwd, globalTrustEnvironment });

    const claudeSkill = join(cwd, ".claude", "skills", "taskless", "SKILL.md");
    expect(await exists(claudeSkill)).toBe(true);

    // Uncheck .claude/ but decline the removal confirm — nothing is removed.
    clackResponses.locations = ["agents"];
    clackResponses.summary = false;
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("cancelled");
    expect(result.cancelledStep).toBe("summary");
    expect(await exists(claudeSkill)).toBe(true);
  });
});

/**
 * The wizard reads the manifest before it migrates anything: `promptLocations`
 * calls `readInstallState`, which is the first thing `runWizard` does inside
 * its frame. An unreadable manifest therefore throws between `intro()` and
 * `outro()`, and the refusal built for `check`, `validate` and
 * `init` has to reach a person here too rather than escaping
 * past a frame nothing closed.
 */
describe("runWizard with an unreadable manifest", () => {
  const CORRUPT = '{"version": 6,\n<<<<<<< HEAD\n}\n';

  it("refuses inside the frame and leaves the file alone", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const manifest = join(cwd, ".taskless", "taskless.json");
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(manifest, CORRUPT, "utf8");

    const { runWizard } = await import("../src/wizard");
    await expect(runWizard({ cwd, globalTrustEnvironment })).rejects.toThrow(
      /could not be read/
    );

    // Closed through `cancel`, so the repair-or-delete remedy lands inside the
    // frame `intro()` opened instead of after it.
    expect(cancelSpy).toHaveBeenCalledWith(
      expect.stringContaining("Repair the JSON")
    );

    // Byte-for-byte: the read throws before the wizard writes anything.
    expect(await readFile(manifest, "utf8")).toBe(CORRUPT);
    expect(captureSpy).not.toHaveBeenCalledWith("cli_installed");
  });
});

/**
 * `init-no-interactive.test.ts` covers this same wiring for `init`, and its
 * own comment names the risk directly: a dropped `console.log` or a swapped
 * field leaves every unit test green while the user is told nothing and their
 * agent keeps serving the previous skills. `runWizard` (src/wizard/index.ts)
 * grew the identical `getReloadNotice` call, but only the `init` path got a
 * test for it -- this mirrors that test's shape for the wizard.
 */
describe("the wizard's restart-your-agents banner", () => {
  it("prints on a second run whose recorded version moved", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    // Plant an older recorded version, the same way
    // `init-no-interactive.test.ts` stages an upgrade: the build under test
    // cannot report two versions in one process, so the move has to be staged
    // in the manifest between two runs.
    const manifestPath = join(cwd, ".taskless", "taskless.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      install?: { cliVersion?: string };
    };
    if (manifest.install) manifest.install.cliVersion = "0.0.1-planted";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runWizard({ cwd, globalTrustEnvironment });
      expect(result.status).toBe("completed");

      const printed = logSpy.mock.calls.map((call) => String(call[0]));
      expect(printed.some((line) => line.includes("RESTART YOUR AGENTS"))).toBe(
        true
      );
      // The version it moved FROM, which is the half a reader needs to tell
      // an upgrade from a downgrade.
      expect(printed.some((line) => line.includes("0.0.1-planted"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("stays quiet on a first run", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runWizard } = await import("../src/wizard");
      const result = await runWizard({ cwd, globalTrustEnvironment });
      expect(result.status).toBe("completed");

      const printed = logSpy.mock.calls.map((call) => String(call[0]));
      expect(printed.some((line) => line.includes("RESTART YOUR AGENTS"))).toBe(
        false
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("stays quiet when the recorded version did not move", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runWizard({ cwd, globalTrustEnvironment });
      expect(result.status).toBe("completed");

      const printed = logSpy.mock.calls.map((call) => String(call[0]));
      expect(printed.some((line) => line.includes("RESTART YOUR AGENTS"))).toBe(
        false
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});

/** Run git in `directory` with an identity and no signing, as a test needs. */
function git(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Taskless Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: directory, encoding: "utf8" }
  );
}

/**
 * #554: a worktree is built from commits, and the install commits nothing, so
 * the wizard offers to make the commit itself. The tests run git with no
 * signing through the environment, which `commitInstall` inherits.
 */
describe("the wizard's offer to commit the install", () => {
  beforeEach(() => {
    git(cwd, "init", "-q");
    vi.stubEnv("GIT_AUTHOR_NAME", "Taskless Test");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
    vi.stubEnv("GIT_COMMITTER_NAME", "Taskless Test");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "commit.gpgsign");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "false");
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;
  });

  it("commits only the install, with the offered message", async () => {
    await writeFile(join(cwd, "unrelated.txt"), "mine\n");
    git(cwd, "add", "unrelated.txt");
    clackResponses.commit = "default";

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    expect(selectMessages).toHaveLength(1);
    expect(git(cwd, "log", "-1", "--format=%s").trim()).toBe(
      "chore: Installs Taskless and sets up coding agent support"
    );
    expect(outroSpy).toHaveBeenCalledWith("Taskless is ready to go.");
    const committed = git(cwd, "show", "--name-only", "--format=", "HEAD");
    expect(committed).toContain(".taskless/taskless.json");
    expect(committed).toContain(".claude/skills/taskless/SKILL.md");
    expect(committed).toContain(".claude/settings.json");
    expect(committed).not.toContain("unrelated.txt");
    // Still staged, exactly as the person left it.
    expect(git(cwd, "status", "--porcelain")).toBe("A  unrelated.txt\n");
  });

  it("commits with the person's own message", async () => {
    clackResponses.commit = "custom";
    clackResponses.commitMessage = "  build: add taskless  ";

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    expect(git(cwd, "log", "-1", "--format=%s").trim()).toBe(
      "build: add taskless"
    );
  });

  it("commits from a subdirectory of the repository", async () => {
    const project = join(cwd, "app");
    await mkdir(join(project, ".claude"), { recursive: true });
    clackResponses.commit = "default";

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd: project, globalTrustEnvironment });

    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("shows git's refusal and still completes when a hook rejects the commit", async () => {
    const hook = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    clackResponses.commit = "default";

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    const warning = warnedMessages.find((message) =>
      message.includes("git could not commit")
    );
    expect(warning).toContain("hook says no");
    expect(warning).toContain("Commit them yourself");
    expect(() => git(cwd, "rev-parse", "--verify", "HEAD")).toThrow();
  });

  it("leaves everything uncommitted when the person will do it", async () => {
    clackResponses.commit = "skip";

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });

    expect(git(cwd, "status", "--porcelain")).toContain("?? .taskless/");
  });

  it("reads a cancel as don't commit, and still completes", async () => {
    clackResponses.commit = fakeCancelSymbol;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(git(cwd, "status", "--porcelain")).toContain("?? .taskless/");
    // Closes on what is true of the tree, not on "ready to go".
    expect(outroSpy).toHaveBeenCalledWith(
      "Taskless is installed, but its files are not committed yet."
    );
  });

  it("does not ask once everything is committed", async () => {
    clackResponses.commit = "default";
    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd, globalTrustEnvironment });
    selectMessages.length = 0;

    await runWizard({ cwd, globalTrustEnvironment });

    expect(selectMessages).toHaveLength(0);
  });
});

describe("the wizard outside a git repository", () => {
  it("does not offer to commit", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    expect(selectMessages).toHaveLength(0);
  });
});

/**
 * The wizard prints the same stale-pin notice the batch path does. The
 * detection and wording are covered in `pinned-cli.test.ts`; this is whether
 * the wizard calls it at all, which is where a dropped line fails silently.
 */
describe("the wizard's stale-pin notice", () => {
  it("names a package.json pin older than the running CLI", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;
    const packageJson = JSON.stringify({
      devDependencies: { "@taskless/cli": "0.0.1" },
    });
    await writeFile(join(cwd, "package.json"), packageJson);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runWizard } = await import("../src/wizard");
      const result = await runWizard({ cwd, globalTrustEnvironment });
      expect(result.status).toBe("completed");

      const printed = logSpy.mock.calls.map((call) => String(call[0]));
      expect(
        printed.some((line) =>
          line.includes("devDependencies: @taskless/cli 0.0.1")
        )
      ).toBe(true);
      // Offered, never applied.
      expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(
        packageJson
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("stays quiet without a stale pin", async () => {
    clackResponses.locations = ["Claude Code"];
    clackResponses.summary = true;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runWizard } = await import("../src/wizard");
      await runWizard({ cwd, globalTrustEnvironment });
      const printed = logSpy.mock.calls.map((call) => String(call[0]));
      expect(printed.some((line) => line.includes("TASKLESS CLI PINS"))).toBe(
        false
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("checking Codex alone installs into .agents and writes its rules file", async () => {
    // Codex on this machine only: the project has no `.codex/`.
    await mkdir(join(globalTrustEnvironment.home, ".codex"));
    clackResponses.locations = ["Codex"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd, globalTrustEnvironment });

    expect(result.status).toBe("completed");
    expect(result.locations).toEqual([".agents"]);
    expect(
      await exists(join(cwd, ".agents", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
    expect(await exists(join(cwd, ".codex", "rules", "taskless.rules"))).toBe(
      true
    );
    // Nothing is written beside the home-directory signal it was found by.
    expect(await exists(join(globalTrustEnvironment.home, ".agents"))).toBe(
      false
    );
    expect(
      await exists(join(globalTrustEnvironment.home, ".codex", "rules"))
    ).toBe(false);
  });
});
