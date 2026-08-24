import { describe, expect, it } from "vitest";

import {
  assertVersionConsistency,
  NIGHTLY_VERSION_ENV,
  OUT_DIRS,
  resolveBuildTarget,
  resolveCliInvocation,
  resolveCliNotice,
  resolveCliVersion,
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

describe("the version a build reports as its own", () => {
  // Only nightly diverges. dev/self/prod all run from a checkout whose
  // package.json IS the version they are, so reading it is correct there.
  it.each(["prod", "dev", "self"])(
    "uses the committed package version for the %s target",
    (target) => {
      expect(
        resolveCliVersion({ TASKLESS_BUILD_TARGET: target }, "0.10.2")
      ).toBe("0.10.2");
    }
  );

  it("uses the committed package version when no target is set", () => {
    expect(resolveCliVersion({}, "0.10.2")).toBe("0.10.2");
  });
});

// #148 post-mortem. The two defines were DERIVED from one stamp but never
// CHECKED against each other, so a single artifact announced one version and
// sent every agent to another, silently. These pin the guard that makes that
// state unbuildable rather than merely unlikely.
describe("a build must agree with itself about its version", () => {
  it("refuses a nightly whose invocation names a different version", () => {
    expect(() =>
      assertVersionConsistency(
        nightlyEnvironment,
        "0.10.2",
        `npx @taskless/cli-nightly@${NIGHTLY_VERSION}`
      )
    ).toThrow(/inconsistent with itself/);
  });

  // The exact shape of the shipped bug, named in the message so whoever hits
  // this next has the history rather than just the assertion.
  it("names the issue and the env var both values derive from", () => {
    expect(() =>
      assertVersionConsistency(
        nightlyEnvironment,
        "0.10.2",
        `npx @taskless/cli-nightly@${NIGHTLY_VERSION}`
      )
    ).toThrow(new RegExp(String.raw`148[\s\S]*` + NIGHTLY_VERSION_ENV));
  });

  it("accepts a nightly whose two values agree", () => {
    expect(() =>
      assertVersionConsistency(
        nightlyEnvironment,
        NIGHTLY_VERSION,
        `npx @taskless/cli-nightly@${NIGHTLY_VERSION}`
      )
    ).not.toThrow();
  });

  // A version pin is meaningless for the other targets: prod names a floating
  // package deliberately, and dev/self name a filesystem path. Asserting there
  // would fail every ordinary build.
  it.each([
    ["prod", "npx @taskless/cli"],
    ["dev", "node /repo/packages/cli/dist-dev/index.js"],
    ["self", "node packages/cli/dist-self/index.js"],
  ])("does not constrain the %s target", (target, invocation) => {
    expect(() =>
      assertVersionConsistency(
        { TASKLESS_BUILD_TARGET: target },
        "0.10.2",
        invocation
      )
    ).not.toThrow();
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

  // #148: the reported symptom. A nightly installed to exercise unreleased
  // behavior wrote `install.cliVersion: 0.10.2` — the release it anticipates —
  // while the skills emitted beside it pinned the nightly it actually was.
  // The version is stamped at pack time and the committed manifest is
  // deliberately left alone, so `package.json` cannot answer this.
  it("reports the stamped version as its own, not the committed one", () => {
    expect(resolveCliVersion(nightlyEnvironment, "0.10.2")).toBe(
      NIGHTLY_VERSION
    );
  });

  // Same refusal as the invocation: a nightly that cannot name its own version
  // has nothing correct to report, and the plausible fallback is the wrong
  // answer that started #148.
  it("refuses to report a version when the stamp is missing", () => {
    expect(() =>
      resolveCliVersion({ TASKLESS_BUILD_TARGET: "nightly" }, "0.10.2")
    ).toThrow(NIGHTLY_VERSION_ENV);
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
