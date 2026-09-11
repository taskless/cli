import { describe, expect, it } from "vitest";

import { shouldLaunchWizard } from "../src/util/interactive";

describe("shouldLaunchWizard", () => {
  const tty = { stdoutIsTTY: true, stdinIsTTY: true };

  it("launches on a terminal with both streams attached", () => {
    expect(shouldLaunchWizard({ ...tty, ci: undefined })).toBe(true);
  });

  it.each([
    ["stdout piped", { stdoutIsTTY: false, stdinIsTTY: true }],
    ["stdin piped", { stdoutIsTTY: true, stdinIsTTY: false }],
    ["neither known", { stdoutIsTTY: undefined, stdinIsTTY: undefined }],
  ])("refuses when %s", (_, streams) => {
    expect(shouldLaunchWizard({ ...streams, ci: undefined })).toBe(false);
  });

  it.each(["true", "1"])(
    "refuses under CI=%s even on a pseudo-terminal",
    (ci) => {
      // `docker run -it` and pty-allocating runners report a TTY on both
      // streams with nobody behind them. This is the guard `init` used to
      // carry, and the one a spawned-CLI test can never exercise.
      expect(shouldLaunchWizard({ ...tty, ci })).toBe(false);
    }
  );

  it.each(["", "0", "false", "yes"])("does not treat CI=%j as CI", (ci) => {
    // Narrow on purpose, and narrower than the telemetry classifier: that
    // one asks what a run IS, this one decides whether to prompt, and they
    // are allowed to disagree. Only the two spellings the old guard read.
    expect(shouldLaunchWizard({ ...tty, ci })).toBe(true);
  });
});
