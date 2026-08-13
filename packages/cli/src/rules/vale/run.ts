import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import type { CheckResult } from "../../types/check";
import { ENGINE_LAYOUTS } from "../engines";
import { buildPath } from "../scan";
import { findValeBinary, valeUnavailableMessage } from "./binary";
import { asValeConfigError, toValeCheckResults, type ValeOutput } from "./map";

/** The committed Vale config, relative to the project root. */
export const COMMITTED_VALE_CONFIG = `.taskless/${ENGINE_LAYOUTS.vale.configFile}`;

/**
 * How long a single Vale invocation may run before it is killed.
 *
 * Vale is fast on ordinary corpora; a run that reaches this has found something
 * pathological (a runaway `script` check, a file that never ends). The number
 * is a ceiling on damage, not a performance target.
 */
export const VALE_TIMEOUT_MS = 60_000;

/**
 * What a Vale run produced.
 *
 * Modeled as an outcome rather than "results or exception" because three of the
 * four cases are things the caller reports and keeps going from. Under D6b an
 * unavailable Vale must not abort the other engines, so the orchestration layer
 * needs to tell "Vale found nothing" from "Vale never ran" — a distinction an
 * empty array erases.
 *
 * `blocking` says whether the outcome should fail the check, as opposed to
 * being reported and moved past. It is carried **on the outcome** rather than
 * derived by a helper the caller must remember to call: every engine we add
 * follows the same shape — run a binary, return a self-describing outcome — and
 * severity is a property of what happened, not knowledge the orchestration
 * layer has to hold about each engine. Literal-typed per variant, so a call
 * site that builds an outcome by hand cannot mislabel it.
 *
 * The three non-ok cases are not equivalent, and collapsing them would be wrong
 * in both directions:
 *
 * - `unavailable` is **non-blocking**. The host has no Vale binary, which is an
 *   ordinary state on an unsupported arch and not evidence of anything wrong
 *   with the user's rules. Failing here would make `check` unrunnable on a
 *   machine where ast-grep and runtime rules are perfectly able to report.
 * - `timeout` and `failed` are **blocking**. Vale was present and was asked to
 *   do its job: it hung, crashed, or rejected the configuration. Reporting
 *   those as a skip would let a broken rule file read as "no Vale findings",
 *   which is indistinguishable from a clean run and is exactly how a silently
 *   disabled engine gets shipped.
 *
 * `ok` is non-blocking even when it carries findings: severity decides the exit
 * code there, the same as for every other engine.
 */
export type ValeRunOutcome =
  | { status: "ok"; blocking: false; results: CheckResult[] }
  | { status: "unavailable"; blocking: false; message: string }
  | { status: "timeout"; blocking: true; message: string }
  | { status: "failed"; blocking: true; message: string };

export interface ValeRunOptions {
  /** Project root. Vale runs here, so its config paths resolve as committed. */
  cwd: string;
  /** Target paths, relative to `cwd`. Empty means Vale's own default set. */
  paths?: string[];
  /** Config path relative to `cwd`. Defaults to the committed engine config. */
  configPath?: string;
  timeoutMs?: number;
}

/**
 * Run Vale over `paths` using the committed config, and map what it reports.
 *
 * `--no-exit` is what makes the exit code readable: without it Vale exits
 * non-zero merely because it found something, which is indistinguishable from
 * failing to run. With it, a non-zero exit means Vale itself failed.
 *
 * The config is read as committed rather than generated per run — it is the
 * source of truth for scoping (matchers), and rewriting it at check time would
 * mean the file a user edits is not the file that executes.
 */
export async function runVale(
  options: ValeRunOptions
): Promise<ValeRunOutcome> {
  const { path: binary, tried } = findValeBinary();
  if (binary === undefined) {
    return {
      status: "unavailable",
      blocking: false,
      message: valeUnavailableMessage(tried),
    };
  }

  const configPath = options.configPath ?? COMMITTED_VALE_CONFIG;
  const paths = options.paths ?? [];
  const timeoutMs = options.timeoutMs ?? VALE_TIMEOUT_MS;

  // `--` separates flags from positional paths, so a path beginning with `-`
  // is not read as a flag.
  // Vale needs somewhere to look. Given no input it prints its usage text and
  // exits 0, which reaches the mapper as "not JSON" and reports the engine as
  // failed on every run — so a whole-project `check`, which passes no paths at
  // all, produced zero Vale findings and one spurious failure. ast-grep is the
  // reason this is easy to miss: it takes its targets from the config and is
  // content with none, so the two engines disagree about what "no paths" means.
  // `cwd` is the project root, so `.` is the whole project.
  const targets = paths.length > 0 ? paths : ["."];
  const argv = [
    "--config",
    configPath,
    "--output=JSON",
    "--no-exit",
    "--",
    ...targets,
  ];

  return new Promise<ValeRunOutcome>((resolve) => {
    const child = spawn(binary, argv, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildPath() },
    });

    // One decoder per stream, not `chunk.toString()` per chunk. A multi-byte
    // UTF-8 sequence split across a chunk boundary would otherwise have each
    // half independently replaced with U+FFFD, and Vale lints free-form prose
    // full of curly quotes, em dashes and accented characters. The damage is
    // not limited to a mangled `Match`: corruption landing inside JSON string
    // escaping makes `JSON.parse` throw, reporting a clean Vale run as
    // `failed`. `runAstGrepScan` in `scan.ts` avoids the same trap by reading
    // stdout through `node:readline`, which decodes for us.
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;

    /** Resolve once. A timeout kill also fires `close`, which must not win. */
    const settle = (outcome: ValeRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        status: "timeout",
        blocking: true,
        message: `Vale exceeded ${String(timeoutMs)}ms and was terminated. The Vale engine reported a timeout; other engines were unaffected.`,
      });
    }, timeoutMs);
    // Do not hold the event loop open on account of the timeout alone.
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(stdoutDecoder.write(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(stderrDecoder.write(chunk));
    });

    child.on("error", (error) => {
      // Near-unreachable, and a real failure rather than a skip when it does
      // happen. `findValeBinary` proved this binary runs by executing
      // `--version` during resolution, so an `error` here means it vanished,
      // lost its permissions, or was quarantined between resolution and
      // execution — not that Vale is uninstalled. Calling that `unavailable`
      // would file a broken host under the advisory skip and let the check
      // pass. `runAstGrepScan` rejects outright on the same event.
      settle({
        status: "failed",
        blocking: true,
        message: `Vale could not be executed at ${binary}: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      // Flush whatever partial multi-byte sequence each decoder is holding, so
      // a stream that ends mid-character contributes its replacement char once
      // rather than leaving bytes unaccounted for.
      stdoutChunks.push(stdoutDecoder.end());
      stderrChunks.push(stderrDecoder.end());

      // With --no-exit, a non-zero code is Vale failing, not Vale finding.
      if (code !== null && code !== 0) {
        const stderr = stderrChunks.join("").trim();
        settle({
          status: "failed",
          blocking: true,
          message: `Vale exited ${String(code)}${stderr === "" ? "" : `: ${stderr}`}`,
        });
        return;
      }

      const stdout = stdoutChunks.join("").trim();
      if (stdout === "") {
        // Measured: Vale prints `{}` when it finds nothing, which parses and
        // maps to [] below. This branch is for a Vale that says nothing at all
        // — cheap insurance against JSON.parse("") reporting a clean run as a
        // failure.
        settle({ status: "ok", blocking: false, results: [] });
        return;
      }

      try {
        const parsed: unknown = JSON.parse(stdout);

        // Defensive, not a live path. Measured against the real binary (a rule
        // with an out-of-vocabulary `level`), a config error goes to stderr
        // with exit 2 and an empty stdout, so the non-zero branch above has
        // already reported it and this shape never arrives here. The guard
        // stays because the cost of being wrong is a crash rather than a wrong
        // answer: mapping a config error walks `Object.entries` over
        // `Line`/`Path`/`Code` and calls `.map` on a number.
        const configError = asValeConfigError(parsed);
        if (configError !== undefined) {
          settle({
            status: "failed",
            blocking: true,
            message: `Vale rejected the configuration (${configError.Code}): ${configError.Text}${
              configError.Path === undefined ? "" : ` in ${configError.Path}`
            }`,
          });
          return;
        }

        settle({
          status: "ok",
          blocking: false,
          results: toValeCheckResults(parsed as ValeOutput),
        });
      } catch (error) {
        settle({
          status: "failed",
          blocking: true,
          message: `Vale produced output that is not JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    });
  });
}

/** Absolute path of the committed Vale config for `cwd`. */
export function valeConfigPath(cwd: string): string {
  return join(cwd, COMMITTED_VALE_CONFIG);
}
