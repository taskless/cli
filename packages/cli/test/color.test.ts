import { afterEach, describe, expect, it, vi } from "vitest";

import { detectColorLevel } from "../src/util/color";

/**
 * Colour depth is decided at RUNTIME, not at build time, and that is the whole
 * reason this function exists: chalk v5 detects on import, the bundle is built
 * with no TTY, so a shipped binary that trusted chalk's own answer would strip
 * every colour and never say why.
 *
 * These assertions pin the precedence, because each rung is a documented
 * promise to someone: `NO_COLOR` to anyone piping output, `FORCE_COLOR` to CI,
 * and the TTY check to everything else.
 */

/**
 * Pretend stdout and stderr are (or are not) a terminal.
 *
 * Assigned rather than spied: `isTTY` is a plain own property that Node only
 * defines when the stream IS a tty, so there is no getter to intercept when it
 * matters most. `vi.spyOn(stream, "isTTY", "get")` throws "isTTY does not
 * exist" under exactly the non-tty case these tests care about.
 */
const originalTTY = {
  stdout: process.stdout.isTTY,
  stderr: process.stderr.isTTY,
};

function withTTY(isTTY: boolean) {
  process.stdout.isTTY = isTTY;
  process.stderr.isTTY = isTTY;
}

afterEach(() => {
  process.stdout.isTTY = originalTTY.stdout;
  process.stderr.isTTY = originalTTY.stderr;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runtime colour detection", () => {
  it("honours NO_COLOR above everything else", () => {
    // Set the two things that would otherwise force colour on. NO_COLOR is a
    // cross-tool convention; losing to FORCE_COLOR would break a pipe.
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("FORCE_COLOR", "3");
    withTTY(true);
    expect(detectColorLevel()).toBe(0);
  });

  it.each([
    ["0", 0],
    ["1", 1],
    ["2", 2],
    ["3", 3],
  ])("takes FORCE_COLOR=%s as level %i, with no TTY", (force, expected) => {
    // The CI case: no terminal, colour wanted anyway.
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", force);
    withTTY(false);
    expect(detectColorLevel()).toBe(expected);
  });

  it("reports no colour when nothing is a terminal", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "");
    withTTY(false);
    expect(detectColorLevel()).toBe(0);
  });

  it.each([
    ["truecolor", "xterm", 3],
    ["24bit", "xterm", 3],
    ["", "xterm-256color", 2],
    ["", "screen-256color", 2],
    ["", "xterm", 1],
    ["", "dumb", 0],
    ["", "", 0],
  ])(
    "reads COLORTERM=%s TERM=%s as level %i on a terminal",
    (colorterm, term, expected) => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("FORCE_COLOR", "");
      vi.stubEnv("COLORTERM", colorterm);
      vi.stubEnv("TERM", term);
      withTTY(true);
      expect(detectColorLevel()).toBe(expected);
    }
  );
});
