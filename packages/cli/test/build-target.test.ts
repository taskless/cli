import { describe, expect, it } from "vitest";

import {
  NIGHTLY_VERSION_ENV,
  OUT_DIRS,
  resolveBuildTarget,
  resolveCliInvocation,
  resolveCliNotice,
  resolveOutputDirectory,
} from "../scripts/build-target";

/** Stand-in for `packages/cli`; only the `dev` target reads it. */
const PACKAGE_DIR = "/repo/packages/cli";

const NIGHTLY_VERSION = "0.11.0-20260818123456x05b3c88";

const nightlyEnvironment = {
  TASKLESS_BUILD_TARGET: "nightly",
  [NIGHTLY_VERSION_ENV]: NIGHTLY_VERSION,
};

describe("build target resolution", () => {
  it("treats an unset or unknown target as prod", () => {
    expect(resolveBuildTarget({})).toBe("prod");
    expect(resolveBuildTarget({ TASKLESS_BUILD_TARGET: "nightlies" })).toBe(
      "prod"
    );
    expect(resolveCliInvocation({}, PACKAGE_DIR)).toBe("npx @taskless/cli");
    expect(resolveCliNotice({}, PACKAGE_DIR)).toBe("");
  });

  it("keeps the local targets pointed at their own output directories", () => {
    const self = { TASKLESS_BUILD_TARGET: "self" };
    expect(resolveCliInvocation(self, PACKAGE_DIR)).toBe(
      `node packages/cli/${OUT_DIRS.self}/index.js`
    );
    expect(resolveCliNotice(self, PACKAGE_DIR)).toContain("pnpm build:self");

    const developmentTarget = { TASKLESS_BUILD_TARGET: "dev" };
    expect(resolveCliInvocation(developmentTarget, PACKAGE_DIR)).toBe(
      `node ${PACKAGE_DIR}/${OUT_DIRS.dev}/index.js`
    );
    expect(resolveCliNotice(developmentTarget, PACKAGE_DIR)).toContain(
      "pnpm build:dev"
    );
  });
});

describe("the nightly target", () => {
  // The whole point of the target: a nightly's skills, commands, and recipes
  // must send an agent to the package the reader installed. Without the
  // version, `npx @taskless/cli-nightly` would float to whatever nightly is
  // newest — a different build from the one whose instructions are being read.
  it("names the nightly package pinned to the exact published version", () => {
    expect(resolveCliInvocation(nightlyEnvironment, PACKAGE_DIR)).toBe(
      `npx @taskless/cli-nightly@${NIGHTLY_VERSION}`
    );
  });

  // `dist`, unlike dev/self — the tarball is packed with `files: ["dist"]` and
  // `bin: ./dist/index.js`, so a nightly build overwrites a prod build.
  it("emits to dist, the same directory as prod", () => {
    expect(resolveOutputDirectory(nightlyEnvironment)).toBe(OUT_DIRS.prod);
    expect(OUT_DIRS.nightly).toBe("dist");
  });

  // dev/self carry a banner because their invocation is a path that may not
  // exist. A published, version-pinned package always resolves, and the
  // invocation already says which package it is.
  it("emits no build notice", () => {
    expect(resolveCliNotice(nightlyEnvironment, PACKAGE_DIR)).toBe("");
  });

  // The failure that matters. Falling back to `npx @taskless/cli` here would
  // reintroduce exactly the bug this target fixes, and would do it silently:
  // the build would succeed and ship instructions for the released package.
  it("fails the build when the version is missing or malformed", () => {
    for (const environment of [
      { TASKLESS_BUILD_TARGET: "nightly" },
      { TASKLESS_BUILD_TARGET: "nightly", [NIGHTLY_VERSION_ENV]: "" },
      { TASKLESS_BUILD_TARGET: "nightly", [NIGHTLY_VERSION_ENV]: "0.11" },
      { TASKLESS_BUILD_TARGET: "nightly", [NIGHTLY_VERSION_ENV]: "latest" },
      {
        TASKLESS_BUILD_TARGET: "nightly",
        [NIGHTLY_VERSION_ENV]: "0.11.0-20260818123456.0123456",
      },
    ]) {
      expect(
        () => resolveCliInvocation(environment, PACKAGE_DIR),
        `${JSON.stringify(environment[NIGHTLY_VERSION_ENV])} must fail the build, not fall back`
      ).toThrowError(new RegExp(NIGHTLY_VERSION_ENV));
    }
  });
});
