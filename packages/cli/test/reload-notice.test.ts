import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";

import { getReloadNotice } from "../src/install/reload-notice";

/**
 * The banner is a box, and a box is only worth printing if it lines up. Every
 * width assertion here measures the UNCOLORED text: chalk emits escape
 * sequences that `String.length` counts and a terminal does not, so asserting
 * on the raw string would pass while the rendered box was ragged.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
const plain = (value: string) => value.replaceAll(ANSI, "");

const NIGHTLY = "0.11.1-20260831132610x088fa7c";
const OLDER_NIGHTLY = "0.11.0-20260826193918xdde086c";

beforeAll(() => {
  // Force colour on, so the alignment assertions run against the string a
  // terminal actually receives rather than a plain one. Without this the
  // escape-stripping above would be untested.
  chalk.level = 3;
});

describe("the restart-your-agents banner", () => {
  // The trigger, stated as the two things that are NOT an upgrade. A banner on
  // every install is one people learn to scroll past.
  it("says nothing on a first install", () => {
    expect(getReloadNotice({ cliVersion: "0.11.1" })).toBeUndefined();
  });

  it("says nothing when the version did not move", () => {
    expect(
      getReloadNotice({ previousCliVersion: "0.11.1", cliVersion: "0.11.1" })
    ).toBeUndefined();
  });

  it.each([
    ["stable to nightly", "0.11.0", NIGHTLY],
    ["nightly to stable", NIGHTLY, "0.11.0"],
    ["nightly to nightly", OLDER_NIGHTLY, NIGHTLY],
    ["a downgrade", "0.11.1", "0.11.0"],
  ])("fires on %s", (_label, previousCliVersion, cliVersion) => {
    // A swap in either direction leaves the same stale copy in a running
    // session, so direction is not the question. Movement is.
    const notice = getReloadNotice({ previousCliVersion, cliVersion });
    expect(notice).toBeDefined();
    expect(plain(notice as string)).toContain("RESTART YOUR AGENTS");
  });

  it("names both versions so the reader can see which way it went", () => {
    const notice = plain(
      getReloadNotice({
        previousCliVersion: OLDER_NIGHTLY,
        cliVersion: NIGHTLY,
      }) as string
    );
    expect(notice).toContain(OLDER_NIGHTLY);
    expect(notice).toContain(NIGHTLY);
  });

  it("tells the reader what to do, not only what happened", () => {
    const notice = plain(
      getReloadNotice({
        previousCliVersion: "0.11.0",
        cliVersion: NIGHTLY,
      }) as string
    );
    expect(notice).toMatch(/Reload skills|start a new session/);
  });

  it.each([
    ["short versions", "0.11.0", "0.11.1"],
    ["a long nightly on one side", "0.11.0", NIGHTLY],
    ["a long nightly on both sides", OLDER_NIGHTLY, NIGHTLY],
  ])(
    "draws a box whose every row is the same width: %s",
    (_label, previousCliVersion, cliVersion) => {
      const rows = plain(
        getReloadNotice({ previousCliVersion, cliVersion }) as string
      )
        .split("\n")
        .filter((line) => line !== "");

      const widths = new Set(rows.map((line) => line.length));
      expect(widths, `rows: ${[...widths].join(", ")}`).toHaveLength(1);
    }
  );

  it("never splits a version across two lines", () => {
    // A wrapped nightly version is a string nobody can copy, and the versions
    // are the one part of this banner a reader may need verbatim.
    const rows = plain(
      getReloadNotice({
        previousCliVersion: OLDER_NIGHTLY,
        cliVersion: NIGHTLY,
      }) as string
    ).split("\n");

    for (const version of [OLDER_NIGHTLY, NIGHTLY]) {
      expect(
        rows.some((line) => line.includes(version)),
        `${version} is broken across lines`
      ).toBe(true);
    }
  });

  it("carries colour, and survives having it stripped", () => {
    const notice = getReloadNotice({
      previousCliVersion: "0.11.0",
      cliVersion: NIGHTLY,
    }) as string;
    expect(notice).not.toBe(plain(notice));
    expect(plain(notice)).toContain("┌");
  });
});
