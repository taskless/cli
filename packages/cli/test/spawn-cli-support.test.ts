import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { cliRejectionToResult } from "./support/spawn-cli";

const execFileAsync = promisify(execFile);

/**
 * The rejections here are REAL, produced by actually spawning something, rather
 * than hand-built objects. The whole point of the helper is that `execFile`
 * reports two very different events through one rejection shape, so a test that
 * asserts against a shape someone typed out would be asserting the assumption
 * instead of the behaviour. That assumption is what taskless/cli#262 turned on.
 */
describe("cliRejectionToResult", () => {
  it("returns a result for a process that ran and exited non-zero", async () => {
    try {
      await execFileAsync("node", [
        "-e",
        "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
      ]);
      expect.unreachable("the process should have exited non-zero");
    } catch (error) {
      const result = cliRejectionToResult(error, ["node", "-e", "..."]);
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("out");
      expect(result.stderr).toBe("err");
    }
  });

  it("throws when the spawn itself failed, instead of reporting an exit code", async () => {
    try {
      await execFileAsync("taskless-cli-binary-that-does-not-exist", ["check"]);
      expect.unreachable("the spawn should have failed");
    } catch (error) {
      // The bug this replaces: `code` here is the string "ENOENT", so a helper
      // returning it as `exitCode` yields a result that passes
      // `expect(exitCode).not.toBe(0)` and carries empty stdout, and the test
      // fails several lines later parsing output that was never written.
      expect((error as { code?: unknown }).code).toBe("ENOENT");
      expect(() =>
        cliRejectionToResult(error, ["missing-binary", "check"])
      ).toThrow(/The CLI never ran: spawn failed with ENOENT/);
    }
  });

  it("names the command and points at the issue, so a recurrence is reportable", () => {
    expect(() =>
      cliRejectionToResult({ code: "EAGAIN" }, [
        "dist/index.js",
        "rule",
        "list",
      ])
    ).toThrow(/dist\/index\.js rule list/);
    expect(() =>
      cliRejectionToResult({ code: "EAGAIN" }, ["dist/index.js"])
    ).toThrow(/taskless\/cli#262/);
  });

  it("treats a process killed by a signal as never having run", () => {
    // `code` is null and `signal` is set. Reading `code` as an exit status here
    // would report `exitCode: null`, which no assertion in the suite expects.
    expect(() =>
      cliRejectionToResult({ code: null, signal: "SIGKILL" }, ["dist/index.js"])
    ).toThrow(/killed by SIGKILL/);
  });
});
