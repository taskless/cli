import { realpathSync } from "node:fs";
import { dirname } from "node:path";

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
 * taskless/cli#262 found the second shape the same rejection hides. Two
 * spawning tests failed once on a full-suite run and passed on a rerun. The
 * cause was a build emptying `dist/` mid-run: node exits with a NUMERIC code 1,
 * empty stdout, and `Cannot find module …/dist/index.js` on stderr. Measured:
 * 22 of 343 spawns failed that way with builds running alongside, 0 of 414
 * without. That one cannot be told apart by `code`, so it is recognised by
 * node naming a module inside the CLI's own directory as missing.
 *
 * Tests now run a per-run snapshot of `dist/` (./distribution-snapshot.ts), which a
 * build cannot touch, so the second shape should not occur. If it does, it
 * should say what it is rather than fail as a contract assertion.
 *
 * Raising a timeout was considered and rejected. Nothing shows the 20s
 * `testTimeout` was ever reached, a CLI spawn is normally sub-second, and a
 * longer ceiling makes a genuine hang slower to surface.
 */

/**
 * Whether node's stderr reports a missing module inside `directory`.
 *
 * The CommonJS loader names the path it was given; the ESM loader names its
 * realpath (measured on macOS: `/var/…` given, `/private/var/…` reported). A
 * chunk missing behind the entry is reported the ESM way, so check both.
 */
function namesMissingModuleIn(stderr: string, directory: string): boolean {
  const spellings = new Set([directory]);
  try {
    spellings.add(realpathSync(directory));
  } catch {
    // The directory itself is gone; the given spelling is all there is.
  }
  return [...spellings].some((spelling) =>
    stderr.includes(`Cannot find module '${spelling}`)
  );
}

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
        `which under a full-suite run is plausibly fork pressure from many ` +
        `concurrent spawns. taskless/cli#262 investigated spawn flakes and ` +
        `found a different cause; if you see this one intermittently, please ` +
        `file a fresh issue quoting this message and the full run output.`
    );
  }

  // Node exits 1 when the entry, or a chunk it imports, is missing, so this
  // one carries a real exit code. Node names the module in both loaders'
  // messages, and nothing the CLI prints names a file inside its own bundle.
  const bundle = dirname(command[0] ?? "");
  if (bundle !== "." && namesMissingModuleIn(rejection.stderr ?? "", bundle)) {
    throw new Error(
      `The CLI never ran: its built bundle is incomplete.\n` +
        `  command: node ${command.join(" ")}\n` +
        `  ${bundle} is missing a module the CLI loads at startup. Tests read ` +
        `a per-run snapshot of dist/ so a concurrent build cannot do this; ` +
        `see ./support/distribution-snapshot.ts and taskless/cli#262.`
    );
  }

  return {
    stdout: rejection.stdout ?? "",
    stderr: rejection.stderr ?? "",
    exitCode: rejection.code,
  };
}
