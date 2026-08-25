import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import type { CheckResult } from "../../types/check";
import { ASSEMBLED_VALE_CONFIG } from "../engines";

import {
  gitIgnoredExclusionGlobs,
  isGitIgnoredPath,
  listGitIgnoredEntries,
} from "../git-ignored";
import { buildPath } from "../scan";
import { isWholeProjectWalk } from "../walk-scope";
import { findValeBinary, valeUnavailableMessage } from "./binary";
import {
  buildValeGlob,
  converterExclusionGlobs,
  findConverterDependentFiles,
  skippedFilesNotice,
  TASKLESS_DIRECTORY,
} from "./formats";
import { asValeConfigError, toValeCheckResults, type ValeOutput } from "./map";

/**
 * The Vale config a run reads, relative to the project root.
 *
 * Assembled from every rule's own `.vale.ini` rather than committed — see
 * `rules/assemble.ts`. Vale accepts exactly one `--config`, so per-rule
 * configuration has to reach one file before it can be invoked.
 */
export { ASSEMBLED_VALE_CONFIG } from "../engines";

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
 *
 * `ok` also carries an optional `notice`: whatever Vale wrote to stderr while
 * still exiting zero. That combination is not noise. Vale reports a rule
 * assignment placed outside any section as `W101 … is ignoring it` — on stderr,
 * with exit 0 and a well-formed empty result on stdout — so discarding it
 * leaves an author with a rule that verifies, runs, and reports nothing.
 * Surfacing it is what makes the section-less scaffold safe: the mistake it
 * invites becomes legible instead of silent.
 */
export type ValeRunOutcome =
  | {
      status: "ok";
      blocking: false;
      results: CheckResult[];
      /** Vale's stderr on a zero-exit run, when it wrote any. */
      notice?: string;
    }
  | { status: "unavailable"; blocking: false; message: string }
  | { status: "timeout"; blocking: true; message: string }
  | { status: "failed"; blocking: true; message: string };

/**
 * Vale's stderr, rendered as a sentence instead of a JSON blob.
 *
 * Vale reports its own errors as a one-object JSON document on stderr —
 * `{Line, Path, Text, Code, Span}` with `Text` carrying embedded newlines. Piped
 * straight into a failure message that lands amid a check's findings, it reads
 * as a stack trace: the actionable half (`asciidoctor not found`) is four lines
 * into a structure whose other four fields say nothing. Same reasoning as
 * decoding ast-grep's stderr rather than forwarding bytes — the message is the
 * only thing the user has to act on.
 *
 * Anything that is not that shape is returned untouched. A best-effort decoder
 * that swallows what it cannot read would be worse than none.
 */
function describeValeStderr(stderr: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stderr);
  } catch {
    return stderr;
  }
  const error = asValeConfigError(parsed);
  if (error === undefined) return stderr;

  const text = error.Text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  // The code stays in the message, and is prepended only when `Text` does not
  // already open with it. Vale is inconsistent about that — `E100` repeats the
  // code in its text and `E201` does not — and the code is what a user searches
  // for, so losing it while "improving" the message would be a downgrade.
  const code = text.startsWith(error.Code) ? "" : `${error.Code}: `;
  return `${code}${text}${
    error.Path === undefined || error.Path === "" ? "" : ` in ${error.Path}`
  }`;
}

export interface ValeRunOptions {
  /** Project root. Vale runs here, so the config's relative paths resolve. */
  cwd: string;
  /** Target paths, relative to `cwd`. Empty means Vale's own default set. */
  paths?: string[];
  /** Config path relative to `cwd`. Defaults to the assembled run config. */
  configPath?: string;
  timeoutMs?: number;
}

/**
 * Run Vale over `paths` using the assembled run config, and map what it reports.
 *
 * `--no-exit` is what makes the exit code readable: without it Vale exits
 * non-zero merely because it found something, which is indistinguishable from
 * failing to run. With it, a non-zero exit means Vale itself failed.
 *
 * The config is assembled from each rule's own `.vale.ini` rather than read
 * from one committed file. The per-rule configs remain the source of truth for
 * scoping, so the matchers a user edits are exactly the matchers that execute —
 * assembly concatenates them in a deterministic order and adds nothing.
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

  const configPath = options.configPath ?? ASSEMBLED_VALE_CONFIG;
  const paths = options.paths ?? [];
  const timeoutMs = options.timeoutMs ?? VALE_TIMEOUT_MS;

  // Vale needs somewhere to look. Given no input it prints its usage text and
  // exits 0, which reaches the mapper as "not JSON" and reports the engine as
  // failed on every run — so a whole-project `check`, which passes no paths at
  // all, produced zero Vale findings and one spurious failure. ast-grep is the
  // reason this is easy to miss: it takes its targets from the config and is
  // content with none, so the two engines disagree about what "no paths" means.
  // `cwd` is the project root, so `.` is the whole project.
  //
  // `isWholeProjectWalk` rather than `paths.length === 0`: `check .` arrives
  // here with `paths = ["."]`, which a length test reads as a user-named path
  // and so skips the `.taskless/` exclusion below. Vale reads hidden
  // directories by default, so that route reported prose findings inside
  // `.taskless/` on any `check .`, independently of the ast-grep fix in this
  // change. Same defect, same signal, one line apart.
  const wholeProject = isWholeProjectWalk(paths);
  const targets = wholeProject ? ["."] : paths;

  // Two exclusions reach Vale, and they have to travel together because Vale
  // accepts exactly one `--glob` and the last one wins — pass two flags and the
  // first is silently discarded, which is how an exclusion becomes a no-op that
  // still looks applied on the command line.
  //
  // `.taskless/**` keeps Vale out of our own directory. Walking the whole
  // project reaches it too, and Vale has no reason to know that directory is
  // ours: with a rule enabled it reports findings in the rule configs and in the
  // user's own rule definitions — prose complaints about the machinery, pointing
  // at files nobody wrote as prose. Section globs do not help, since
  // `.taskless/README.md` matches `[*.md]` as readily as any document. Applied
  // ONLY when we chose `.` ourselves: an explicit path is a request, and
  // silently declining to check a file someone named would be worse than
  // checking one they did not.
  //
  // The converter-dependent formats are excluded on **every** run, named path or
  // not, and that asymmetry is deliberate. Handing Vale one `.adoc` on a host
  // with no `asciidoctor` does not check that file badly — it aborts the entire
  // Vale process before any result is written, taking every other file's
  // findings with it. Honouring the request would cost the user the rest of
  // their check, so the request is declined and reported instead. See
  // `formats.ts` for the tier table this is derived from.
  //
  // What git ignores, on a whole-project walk only — same terms as
  // `.taskless/**` above, and for a sharper version of the same reason. Vale
  // has no notion of a VCS: it walked into build output, vendored trees, and a
  // git worktree at `worktrees/<name>/`, which is a complete second checkout,
  // so every prose rule fired again against another branch's documents
  // (taskless/cli#166). ast-grep needed no equivalent — its walker honors
  // `.gitignore` already — which is precisely why the two engines disagreed
  // about which files the project contains. Asked only when we chose `.`
  // ourselves, so `check worktrees/probe` still checks what it was handed.
  const ignoredEntries = wholeProject
    ? await listGitIgnoredEntries(options.cwd)
    : [];

  const exclude = [
    ...(wholeProject
      ? [
          `${TASKLESS_DIRECTORY}/**`,
          ...gitIgnoredExclusionGlobs(ignoredEntries),
        ]
      : []),
    ...converterExclusionGlobs(),
  ];
  const globArgument = buildValeGlob(exclude);
  const globFlags = globArgument === undefined ? [] : [globArgument];

  // Asked before the run rather than inferred from it. Vale never reports what
  // its walker declined to open, so once the glob has done its job the skipped
  // files are unrecoverable from the output — and a fix whose only visible
  // effect is that some findings are quietly missing is the bug it replaced.
  //
  // The ignored paths are filtered back out for the same reason the notice
  // exists at all: it must describe the run that happened. An `.adoc` inside
  // `worktrees/` is not a file this run declined to convert — it is a file this
  // run was never going to look at, and naming it would send the reader to
  // investigate a directory the fix above deliberately excluded.
  const converterDependent = await findConverterDependentFiles(
    options.cwd,
    paths
  );
  const skipped = skippedFilesNotice(
    converterDependent.filter((file) => !isGitIgnoredPath(file, ignoredEntries))
  );

  // `--` separates flags from positional paths, so a path beginning with `-`
  // is not read as a flag.
  const argv = [
    "--config",
    configPath,
    "--output=JSON",
    "--no-exit",
    ...globFlags,
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
          message: `Vale exited ${String(code)}${
            stderr === "" ? "" : `: ${describeValeStderr(stderr)}`
          }`,
        });
        return;
      }

      // Exit was zero, so anything on stderr is a diagnostic about a run that
      // otherwise succeeded — the `W101` ignored-assignment warning above all.
      // Attached to every `ok` path so a diagnostic cannot be dropped by which
      // branch happened to produce the (empty) results.
      const diagnostic = stderrChunks.join("").trim();
      // Both advisories share one field, so they are joined rather than one
      // overwriting the other: a project can perfectly well have a section-less
      // rule assignment *and* an AsciiDoc file, and dropping either message
      // would be a silent skip wearing the other's clothes.
      const advisories = [
        ...(skipped === undefined ? [] : [skipped]),
        ...(diagnostic === ""
          ? []
          : [`Vale reported while running: ${diagnostic}`]),
      ];
      const notice =
        advisories.length === 0 ? {} : { notice: advisories.join("\n") };

      const stdout = stdoutChunks.join("").trim();
      if (stdout === "") {
        // Measured: Vale prints `{}` when it finds nothing, which parses and
        // maps to [] below. This branch is for a Vale that says nothing at all
        // — cheap insurance against JSON.parse("") reporting a clean run as a
        // failure.
        settle({ status: "ok", blocking: false, results: [], ...notice });
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
          ...notice,
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
  return join(cwd, ASSEMBLED_VALE_CONFIG);
}
