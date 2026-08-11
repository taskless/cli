import { spawn } from "node:child_process";
import { join } from "node:path";

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
 */
export type ValeRunOutcome =
  | { status: "ok"; results: CheckResult[] }
  | { status: "unavailable"; message: string }
  | { status: "timeout"; message: string }
  | { status: "failed"; message: string };

/**
 * Whether an outcome should fail the check, as opposed to being reported and
 * moved past.
 *
 * The three non-ok cases are not equivalent, and collapsing them would be
 * wrong in both directions:
 *
 * - `unavailable` is a **skip**. The host has no Vale binary, which is an
 *   ordinary state on an unsupported arch and not evidence of anything wrong
 *   with the user's rules. Failing here would make `check` unrunnable on a
 *   machine where ast-grep and runtime rules are perfectly able to report.
 * - `timeout` and `failed` are **errors**. Vale was present and was asked to do
 *   its job: it hung, crashed, or rejected the configuration. Reporting those
 *   as a skip would let a broken rule file read as "no Vale findings", which is
 *   indistinguishable from a clean run and is exactly how a silently disabled
 *   engine gets shipped.
 *
 * Exported here rather than decided at the call site so orchestration (2.2)
 * derives the exit code from one rule instead of restating it.
 */
export function isValeFailure(outcome: ValeRunOutcome): boolean {
  return outcome.status === "timeout" || outcome.status === "failed";
}

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
    return { status: "unavailable", message: valeUnavailableMessage(tried) };
  }

  const configPath = options.configPath ?? COMMITTED_VALE_CONFIG;
  const paths = options.paths ?? [];
  const timeoutMs = options.timeoutMs ?? VALE_TIMEOUT_MS;

  // `--` separates flags from positional paths, so a path beginning with `-`
  // is not read as a flag.
  const argv = [
    "--config",
    configPath,
    "--output=JSON",
    "--no-exit",
    ...(paths.length > 0 ? ["--", ...paths] : []),
  ];

  return new Promise<ValeRunOutcome>((resolve) => {
    const child = spawn(binary, argv, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildPath() },
    });

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
        message: `Vale exceeded ${String(timeoutMs)}ms and was terminated. The Vale engine reported a timeout; other engines were unaffected.`,
      });
    }, timeoutMs);
    // Do not hold the event loop open on account of the timeout alone.
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on("error", (error) => {
      // Near-unreachable: the binary was verified by running it during
      // resolution, so this means it vanished in between.
      settle({
        status: "unavailable",
        message: `Vale could not be executed at ${binary}: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      // With --no-exit, a non-zero code is Vale failing, not Vale finding.
      if (code !== null && code !== 0) {
        const stderr = stderrChunks.join("").trim();
        settle({
          status: "failed",
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
        settle({ status: "ok", results: [] });
        return;
      }

      try {
        const parsed: unknown = JSON.parse(stdout);

        // A malformed rule makes Vale emit a config error and still exit 0, so
        // this is the only place the difference is detectable.
        const configError = asValeConfigError(parsed);
        if (configError !== undefined) {
          settle({
            status: "failed",
            message: `Vale rejected the configuration (${configError.Code}): ${configError.Text}${
              configError.Path === undefined ? "" : ` in ${configError.Path}`
            }`,
          });
          return;
        }

        settle({
          status: "ok",
          results: toValeCheckResults(parsed as ValeOutput),
        });
      } catch (error) {
        settle({
          status: "failed",
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
