/**
 * Tell a CLI that ran and failed apart from a CLI that never ran.
 *
 * WHY THIS EXISTS. 28 test files spawn `dist/index.js` through `execFile` and
 * each wrote the same `catch`: treat the rejection as the CLI having exited
 * non-zero, and read `error.code` as its exit code. That is right for a process
 * that ran. It is wrong for a spawn that never happened, and the two are the
 * same rejection.
 *
 * Measured, spawning a binary that does not exist:
 *
 *   spawn failure     ->  code: "ENOENT"  stdout: ""
 *   real non-zero exit ->  code: 1        stdout: "{}"
 *
 * `code` is a STRING errno on the first, so a helper that returns it as
 * `exitCode` produces a result where `expect(exitCode).not.toBe(0)` PASSES (a
 * string is not 0) and `stdout` is empty. The test then fails several lines
 * later, parsing an envelope that was never written, with a generic
 * "expected 0 to be greater than 0" from inside a helper. Nothing in that
 * message mentions spawning.
 *
 * That matters because of taskless/cli#262: two spawning tests failed once on a
 * full-suite run and passed on an immediate rerun, with the assertion output
 * lost because it said nothing useful. The plausible cause is fork pressure
 * (`EAGAIN`) from many concurrent spawns, which takes exactly the path above.
 * The flake has not reproduced in 8 consecutive full runs, so the useful move
 * on an unreproducible failure is not to guess at a fix but to make the next
 * occurrence describe itself.
 *
 * Raising a timeout was considered and rejected. Nothing shows the 20s
 * `testTimeout` was ever reached, a CLI spawn is normally sub-second, and a
 * longer ceiling makes a genuine hang slower to surface.
 */

/** What a spawned CLI did, once we know it actually ran. */
export interface SpawnedCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecFileRejection {
  stdout?: string;
  stderr?: string;
  code?: unknown;
  signal?: string | null;
}

/**
 * Normalise a rejected `execFile` into a result, or throw if the CLI never ran.
 *
 * Call it from the `catch` of a spawning helper. A process that ran and exited
 * non-zero comes back as an ordinary result; anything else throws with the
 * errno and the command, because it is a fact about the machine rather than
 * about the behaviour under test.
 */
export function cliRejectionToResult(
  error: unknown,
  command: readonly string[]
): SpawnedCliResult {
  const rejection = error as ExecFileRejection;

  // A real exit status is a number. An errno (`EAGAIN`, `ENOENT`, `ENOMEM`) is
  // a string, and a process killed by a signal reports `code: null` with
  // `signal` set. Neither is the CLI making a decision.
  if (typeof rejection.code !== "number") {
    // `code` is typed `unknown` because that is what it honestly is here: a
    // string errno, or null beside a signal. Narrowing rather than coercing,
    // so an unexpected shape reads as unknown instead of "[object Object]".
    const errno =
      typeof rejection.code === "string" ? rejection.code : "an unknown error";
    const cause =
      typeof rejection.signal === "string"
        ? `killed by ${rejection.signal}`
        : `spawn failed with ${errno}`;
    throw new Error(
      `The CLI never ran: ${cause}.\n` +
        `  command: node ${command.join(" ")}\n` +
        `  This is not a CLI contract failure. It is the process not starting, ` +
        `most often fork pressure from many concurrent spawns under a full-suite ` +
        `run. If you are seeing this intermittently, that is taskless/cli#262: ` +
        `please file a fresh issue quoting this message and the full run output.`
    );
  }

  return {
    stdout: rejection.stdout ?? "",
    stderr: rejection.stderr ?? "",
    exitCode: rejection.code,
  };
}
