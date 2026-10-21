import { describe, expect, it } from "vitest";

import { hasVersionMismatchOverride } from "../src/filesystem/migrate";
import {
  findVersionMismatch,
  versionMismatchMessage,
} from "../src/install/version-gate";

const RELEASE = "@taskless/cli";
const NIGHTLY = "@taskless/cli-nightly";

function mismatch(install?: unknown, running = "0.14.0", command = "check") {
  return findVersionMismatch({
    command,
    running,
    runningPackage: running.includes("-") ? NIGHTLY : RELEASE,
    install,
  });
}

/**
 * The CLI that runs a project's rules must be the CLI the project recorded.
 * "Recorded" is what that package's launcher runs, so these cases mirror the
 * launcher's own resolution.
 */
describe("finding a version mismatch", () => {
  it("passes a CLI that is the recorded version", () => {
    expect(mismatch({ launchers: { [RELEASE]: "0.14.0" } })).toBeUndefined();
  });

  it("refuses a newer CLI", () => {
    expect(mismatch({ launchers: { [RELEASE]: "0.13.2" } })).toEqual({
      runningPackage: RELEASE,
      running: "0.14.0",
      recordedPackage: RELEASE,
      recorded: "0.13.2",
    });
  });

  it("refuses an older CLI", () => {
    expect(mismatch({ cliVersion: "0.15.0" }, "0.14.0")?.recorded).toBe(
      "0.15.0"
    );
  });

  it("falls back to cliVersion only when it belongs to the package", () => {
    // A nightly cliVersion says nothing about the release launcher, and the
    // project records nothing else for the release, so it is the other channel.
    expect(mismatch({ cliVersion: "0.15.0-20261020x1" })).toMatchObject({
      recordedPackage: NIGHTLY,
    });
  });

  it("passes either channel in a project carrying both launchers", () => {
    const install = {
      cliVersion: "0.15.0-20261020x1",
      launchers: { [RELEASE]: "0.14.0", [NIGHTLY]: "0.15.0-20261020x1" },
    };
    expect(mismatch(install, "0.14.0")).toBeUndefined();
    expect(mismatch(install, "0.15.0-20261020x1")).toBeUndefined();
  });

  it("refuses a CLI whose channel the project never recorded", () => {
    expect(
      mismatch({ launchers: { [NIGHTLY]: "0.15.0-20261020x1" } }, "0.14.0")
    ).toMatchObject({ recordedPackage: NIGHTLY });
  });

  it("does not gate a project that records no version", () => {
    expect(mismatch()).toBeUndefined();
    expect(mismatch({ onboarded: true })).toBeUndefined();
    expect(mismatch({ cliVersion: 7, launchers: "nope" })).toBeUndefined();
  });

  it.each(["init", "info", "auth", "feedback", undefined])(
    "does not gate %s",
    (command) => {
      expect(
        findVersionMismatch({
          command,
          running: "0.14.0",
          runningPackage: RELEASE,
          install: { cliVersion: "0.13.2" },
        })
      ).toBeUndefined();
    }
  );

  it("gates update, which moves the rules' record and not the CLI's", () => {
    expect(
      mismatch({ cliVersion: "0.13.2" }, "0.14.0", "update")
    ).toBeDefined();
  });

  it("does not gate a self build or an unknown version", () => {
    const install = { cliVersion: "0.13.2" };
    expect(
      findVersionMismatch({
        command: "check",
        running: "0.14.0",
        runningPackage: undefined,
        install,
      })
    ).toBeUndefined();
    expect(
      findVersionMismatch({
        command: "check",
        running: "unknown",
        runningPackage: RELEASE,
        install,
      })
    ).toBeUndefined();
  });
});

describe("the version mismatch message", () => {
  const options = { command: "check", launcherExists: true, prefix: "npx x" };

  it("offers the launcher and init to a newer CLI", () => {
    const message = versionMismatchMessage(
      mismatch({ cliVersion: "0.13.2" })!,
      options
    );
    expect(message).toContain("@taskless/cli 0.14.0");
    expect(message).toContain("@taskless/cli 0.13.2");
    expect(message).toContain("`./.taskless/bin/cli.mjs check`");
    expect(message).toContain("`npx x init` to move the project to 0.14.0");
  });

  it("never offers init to an older CLI", () => {
    const message = versionMismatchMessage(
      mismatch({ cliVersion: "0.15.0" })!,
      options
    );
    expect(message).toContain("`./.taskless/bin/cli.mjs check`");
    expect(message).not.toContain("init");
  });

  it("does not name a launcher the project does not have", () => {
    const message = versionMismatchMessage(
      mismatch({ cliVersion: "0.13.2" })!,
      { ...options, launcherExists: false }
    );
    expect(message).not.toContain(".taskless/bin");
    expect(message).toContain("`npx x init`");
  });
});

describe("the version mismatch override", () => {
  it("reads the flag", () => {
    expect(hasVersionMismatchOverride(["--allow-version-mismatches"], {})).toBe(
      true
    );
  });

  it.each(["1", "true", "TRUE"])("reads the environment set to %s", (value) => {
    expect(
      hasVersionMismatchOverride([], {
        TASKLESS_ALLOW_VERSION_MISMATCHES: value,
      })
    ).toBe(true);
  });

  it("is off with neither, or an environment value that is not a yes", () => {
    expect(hasVersionMismatchOverride([], {})).toBe(false);
    expect(
      hasVersionMismatchOverride([], { TASKLESS_ALLOW_VERSION_MISMATCHES: "0" })
    ).toBe(false);
  });
});
