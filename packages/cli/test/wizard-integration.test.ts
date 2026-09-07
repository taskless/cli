import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureSpy = vi.fn();
vi.mock("../src/telemetry", () => ({
  getTelemetry: () =>
    Promise.resolve({ capture: captureSpy, shutdown: () => Promise.resolve() }),
  shutdownTelemetry: () => Promise.resolve(),
}));

const fakeCancelSymbol = Symbol("cancel");

// Records what closed the clack frame, so a test can tell "the message was
// shown inside the frame" from "it escaped past a frame nothing closed".
const cancelSpy = vi.fn();

// Clack mock responses are set per-test via these mutable refs.
const clackResponses: {
  locations?: string[] | symbol;
  auth?: boolean | symbol;
  summary?: boolean | symbol;
} = {};

// Captures the message of the summary confirm prompt for assertions.
let summaryConfirmMessage: string | undefined;

vi.mock("@clack/prompts", () => ({
  intro: () => {},
  outro: () => {},
  cancel: (message?: string) => {
    cancelSpy(message);
  },
  log: {
    info: () => {},
    message: () => {},
    error: () => {},
    warn: () => {},
  },
  note: () => {},
  isCancel: (value: unknown) => value === fakeCancelSymbol,
  multiselect: vi.fn(() => Promise.resolve(clackResponses.locations)),
  confirm: vi.fn(({ message }: { message: string }) => {
    if (message.toLowerCase().includes("log in")) {
      return Promise.resolve(clackResponses.auth);
    }
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

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-wizard-e2e-"));
  await mkdir(join(cwd, ".claude"), { recursive: true });
  captureSpy.mockClear();
  cancelSpy.mockClear();
  clackResponses.locations = undefined;
  clackResponses.auth = undefined;
  clackResponses.summary = undefined;
  summaryConfirmMessage = undefined;
  vi.stubEnv("TASKLESS_TOKEN", "stub-token");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(cwd, { recursive: true, force: true });
  vi.resetModules();
});

describe("runWizard end-to-end", () => {
  it("installs all bundled skills to selected location and records manifest", async () => {
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd });

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

  it("re-running with the same location is idempotent", async () => {
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd });
    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);

    // Re-run with the same selection — no diff, should complete cleanly.
    await runWizard({ cwd });
    expect(
      await exists(join(cwd, ".claude", "skills", "taskless", "SKILL.md"))
    ).toBe(true);
  });

  it("cancelling at locations step writes nothing and emits no install event", async () => {
    clackResponses.locations = fakeCancelSymbol;

    const { runWizard } = await import("../src/wizard");
    const result = await runWizard({ cwd });

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

  it("cancelling the summary confirm writes nothing", async () => {
    clackResponses.locations = [".claude"];
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
    const result = await runWizard({ cwd });
    expect(result.status).toBe("cancelled");
    expect(result.cancelledStep).toBe("summary");
  });

  it("unchecking a previously-installed location removes its stubs", async () => {
    const { runWizard } = await import("../src/wizard");

    // First run: install Taskless into both .claude/ and .agents/.
    clackResponses.locations = [".claude", ".agents"];
    clackResponses.summary = true;
    await runWizard({ cwd });

    const claudeSkill = join(cwd, ".claude", "skills", "taskless", "SKILL.md");
    const agentsSkill = join(cwd, ".agents", "skills", "taskless", "SKILL.md");
    expect(await exists(claudeSkill)).toBe(true);
    expect(await exists(agentsSkill)).toBe(true);

    // Second run: uncheck .claude/, keep .agents/ — consolidating onto .agents.
    summaryConfirmMessage = undefined;
    clackResponses.locations = [".agents"];
    clackResponses.summary = true;
    const result = await runWizard({ cwd });

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

    clackResponses.locations = [".claude", ".agents"];
    clackResponses.summary = true;
    await runWizard({ cwd });

    const claudeSkill = join(cwd, ".claude", "skills", "taskless", "SKILL.md");
    expect(await exists(claudeSkill)).toBe(true);

    // Uncheck .claude/ but decline the removal confirm — nothing is removed.
    clackResponses.locations = [".agents"];
    clackResponses.summary = false;
    const result = await runWizard({ cwd });

    expect(result.status).toBe("cancelled");
    expect(result.cancelledStep).toBe("summary");
    expect(await exists(claudeSkill)).toBe(true);
  });
});

/**
 * The wizard reads the manifest before it migrates anything: `promptLocations`
 * calls `readInstallState`, which is the first thing `runWizard` does inside
 * its frame. An unreadable manifest therefore throws between `intro()` and
 * `outro()`, and the refusal built for `check`, `verify` and
 * `init --no-interactive` has to reach a person here too rather than escaping
 * past a frame nothing closed.
 */
describe("runWizard with an unreadable manifest", () => {
  const CORRUPT = '{"version": 6,\n<<<<<<< HEAD\n}\n';

  it("refuses inside the frame and leaves the file alone", async () => {
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const manifest = join(cwd, ".taskless", "taskless.json");
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(manifest, CORRUPT, "utf8");

    const { runWizard } = await import("../src/wizard");
    await expect(runWizard({ cwd })).rejects.toThrow(/could not be read/);

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
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd });

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
      const result = await runWizard({ cwd });
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
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { runWizard } = await import("../src/wizard");
      const result = await runWizard({ cwd });
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
    clackResponses.locations = [".claude"];
    clackResponses.summary = true;

    const { runWizard } = await import("../src/wizard");
    await runWizard({ cwd });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runWizard({ cwd });
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
