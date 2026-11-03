import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReconcileStatus } from "../src/rules/reconcile-status";

const checkStaleness = vi.fn();
vi.mock("../src/install/install", () => ({
  checkStaleness: (cwd: string): unknown => checkStaleness(cwd),
}));

const reconcileStatus = vi.fn();
vi.mock("../src/rules/reconcile-status", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/rules/reconcile-status")>();
  return {
    ...actual,
    reconcileStatus: (...args: unknown[]): unknown => reconcileStatus(...args),
  };
});

vi.mock("../src/filesystem/manifest", () => ({
  readManifest: () => Promise.resolve({ manifest: { rules: {} }, raw: {} }),
}));

const { environmentNotice, environmentSteps, measureEnvironment } =
  await import("../src/install/freshness");

const CURRENT_SKILLS = [
  {
    name: "Claude Code",
    skills: [
      {
        name: "taskless",
        installedVersion: "1.0.0",
        currentVersion: "1.0.0",
        current: true,
      },
    ],
  },
];
const STALE_SKILLS = [
  {
    name: "Claude Code",
    skills: [
      {
        name: "taskless",
        installedVersion: "0.9.0",
        currentVersion: "1.0.0",
        current: false,
      },
    ],
  },
];
const RECONCILED: ReconcileStatus = {
  required: false,
  walk: null,
  engines: [],
  ruleMigrations: [],
};
const OWES_RECONCILE: ReconcileStatus = {
  required: true,
  walk: { from: "0.9.0", to: "1.0.0" },
  engines: [],
  ruleMigrations: [],
};

function registry(latest: string): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(Response.json({ latest }))
  ) as unknown as typeof fetch;
}

const SPELLING = { invocation: "npx @taskless/cli@1.0.0", launcher: "npx" };

describe("measureEnvironment", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "taskless-freshness-"));
    checkStaleness.mockReset().mockResolvedValue(CURRENT_SKILLS);
    reconcileStatus.mockReset().mockResolvedValue(RECONCILED);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function project(): void {
    mkdirSync(join(directory, ".taskless"));
  }

  function measure(fetcher: typeof fetch, ci?: string) {
    return measureEnvironment({
      cwd: directory,
      ci,
      fetch: fetcher,
      running: "1.0.0",
      packageName: "@taskless/cli",
    });
  }

  it("reports nothing when everything is current", async () => {
    project();
    const measured = await measure(registry("1.0.0"));
    expect(measured).toEqual({
      cli: undefined,
      skill: undefined,
      rules: undefined,
    });
    expect(environmentSteps(measured, SPELLING)).toEqual([]);
  });

  it("reports a newer published CLI with an exact pin", async () => {
    const measured = await measure(registry("1.1.0"));
    expect(measured.cli).toEqual({
      packageName: "@taskless/cli",
      running: "1.0.0",
      latest: "1.1.0",
    });
    const [step] = environmentSteps(measured, SPELLING);
    expect(step?.part).toBe("cli");
    expect(step?.command).toBe("npx @taskless/cli@1.1.0");
    expect(step?.text).toContain("1.0.0");
  });

  it("does not report an older published version", async () => {
    const measured = await measure(registry("0.9.0"));
    expect(measured.cli).toBeUndefined();
  });

  it("reports a stale skill with the bare invocation", async () => {
    project();
    checkStaleness.mockResolvedValue(STALE_SKILLS);
    const measured = await measure(registry("1.0.0"));
    const steps = environmentSteps(measured, SPELLING);
    expect(steps).toEqual([
      expect.objectContaining({
        part: "skill",
        command: "npx @taskless/cli@1.0.0",
      }),
    ]);
  });

  it("reports rules owing a reconcile with update", async () => {
    project();
    reconcileStatus.mockResolvedValue(OWES_RECONCILE);
    const steps = environmentSteps(await measure(registry("1.0.0")), SPELLING);
    expect(steps).toEqual([
      expect.objectContaining({
        part: "rules",
        command: "npx @taskless/cli@1.0.0 update",
      }),
    ]);
  });

  it("orders all three, and the newer CLI absorbs the skill command", async () => {
    project();
    checkStaleness.mockResolvedValue(STALE_SKILLS);
    reconcileStatus.mockResolvedValue(OWES_RECONCILE);
    const steps = environmentSteps(await measure(registry("2.0.0")), SPELLING);
    expect(steps.map((step) => step.part)).toEqual(["cli", "skill", "rules"]);
    expect(steps[1]?.command).toBeUndefined();
    const notice = environmentNotice(steps);
    expect(notice).toContain("(1) ");
    expect(notice).toContain("Run: npx @taskless/cli@2.0.0");
    expect(notice).not.toContain("\n");
  });

  it("leaves out skill and rules outside a .taskless/ project", async () => {
    checkStaleness.mockResolvedValue(STALE_SKILLS);
    reconcileStatus.mockResolvedValue(OWES_RECONCILE);
    const measured = await measure(registry("1.0.0"));
    expect(measured.skill).toBeUndefined();
    expect(measured.rules).toBeUndefined();
    expect(checkStaleness).not.toHaveBeenCalled();
  });

  it("never asks the registry in CI", async () => {
    const fetcher = registry("9.9.9");
    const measured = await measure(fetcher, "true");
    expect(fetcher).not.toHaveBeenCalled();
    expect(measured.cli).toBeUndefined();
  });

  it("never asks the registry when NO_UPDATE_NOTIFIER is set", async () => {
    const fetcher = registry("9.9.9");
    const measured = await measureEnvironment({
      cwd: directory,
      fetch: fetcher,
      noUpdateNotifier: "1",
      running: "1.0.0",
      packageName: "@taskless/cli",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(measured.cli).toBeUndefined();
  });

  it("never asks the registry for a build that is not a package", async () => {
    const fetcher = registry("9.9.9");
    const measured = await measureEnvironment({
      cwd: directory,
      fetch: fetcher,
      running: "1.0.0",
      packageName: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(measured.cli).toBeUndefined();
  });

  it("has no notice when nothing is out of date", () => {
    expect(environmentNotice([])).toBeUndefined();
  });
});
