import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
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
  findOversizedFiles,
  oversizedFilesNotice,
  skippedFilesNotice,
  TASKLESS_DIRECTORY,
} from "./formats";
import {
  asValeConfigError,
  toValeCheckResults,
  type ValeConfigError,
  type ValeOutput,
} from "./map";

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
 * The largest single file Vale will be asked to check, in bytes. A file over
 * this is excluded from the Vale invocation and named in a notice — see
 * `oversizedFilesNotice` in `formats.ts` for why a notice and not a finding —
 * the same preemptive treatment `converterExclusionGlobs` gives a format Vale
 * cannot parse (taskless/cli#321).
 *
 * ## Why a size guard at all: Vale is quadratic in one file's size
 *
 * Measured against the pinned binary, one `existence` rule, one file, over
 * three runs each, median taken (an M-series laptop; a CI runner is assumed
 * ~4x slower, NOT measured):
 *
 * | size  | median (laptop) | ~4x slower CI runner | share of the 60s run budget |
 * | ----- | ---------------- | --------------------- | ---------------------------- |
 * | 128KB | 0.77s            | ~3.1s                 | 5%                           |
 * | 192KB | 1.87s            | ~7.5s                 | 12%                          |
 * | 256KB | 3.30s            | ~13.2s                | 22%                          |
 * | 384KB | 7.27s            | ~29.1s                | 48%                          |
 *
 * This is upstream Vale's behaviour on a single file, not ours, and it is per
 * FILE, not per corpus: the same ~1MB of prose spread across 400 files takes
 * 190ms. Volume is fine; size is not, and the risk is concentrated in outliers
 * rather than spread across a corpus.
 *
 * ## The budget being protected is the WHOLE RUN, not one file
 *
 * {@link VALE_TIMEOUT_MS} bounds one Vale invocation over every target file
 * combined, so the question a size guard has to answer is not "is this file
 * slow" but "how much of the shared budget may one outlier consume". At 384KB
 * a single file can already claim roughly half the run's timeout on its own —
 * two of them, or one plus a project's ordinary corpus, is enough to blow the
 * budget and take every other file's findings down with it (exactly the #300
 * failure, on a path #300 did not cover). That effect compounds with rule
 * count too: a real project runs several rules over the same file in one Vale
 * invocation, and each one pays the quadratic cost again.
 *
 * ## Why 128KB (`128 * 1024` bytes)
 *
 * At 128KB a pathological file costs at most roughly 5% of the run's budget,
 * even on the slower, unmeasured CI estimate — small enough that it takes many
 * such files at once to threaten the timeout, rather than one. The choice also
 * has to not eat real documents: 128KB of markdown is roughly 20,000 words,
 * comfortably past any file a person actually sits down and writes by hand —
 * what this excludes is generated output, pasted data dumps, or exported notes,
 * not hand-authored prose. Measured against this repository, the largest
 * committed markdown file (`packages/cli/CHANGELOG.md`) is 139KB — just over
 * this limit, and itself a generated file (a changelog appended to by tooling,
 * not written by hand in one sitting), which is exactly the shape of file this
 * guard is meant to catch.
 *
 * This bounds the worst SINGLE file, not the run's total cost: many mid-sized
 * files under the limit still accumulate. A normal corpus is cheap regardless
 * (400 files of ~2KB measured at 190ms total), so that accumulation only
 * matters when a project is unusually large, which {@link VALE_TIMEOUT_MS}
 * still exists to catch.
 *
 * Exported and named so it is discoverable and tunable independently of
 * {@link VALE_TIMEOUT_MS}: the two bound different things (one file's cost, the
 * whole run's budget) and moving one should not require reasoning about the
 * other.
 */
export const VALE_MAX_FILE_BYTES = 128 * 1024;

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
 * Parse Vale's stderr as its one-object config-error document, or `undefined`
 * when it is not that shape.
 *
 * Split out from {@link describeValeStderr} so the non-zero-exit branch in
 * {@link spawnVale} can parse `stderr` exactly once and use the result both to
 * build the failure message and to populate `ValeAttempt.configError` — the
 * value {@link targetFileParseError} reads to decide whether this failure can
 * be narrowed to one target file and retried. Without this split, the same
 * bytes were parsed twice: once here, once again inside `describeValeStderr`.
 */
function parseValeConfigError(stderr: string): ValeConfigError | undefined {
  try {
    return asValeConfigError(JSON.parse(stderr));
  } catch {
    return undefined;
  }
}

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
 * Takes the already-parsed error rather than re-parsing `stderr` itself — see
 * {@link parseValeConfigError}. Anything that did not parse to that shape is
 * returned untouched. A best-effort decoder that swallows what it cannot read
 * would be worse than none.
 */
function describeValeStderr(
  stderr: string,
  configError: ValeConfigError | undefined
): string {
  if (configError === undefined) return stderr;
  return formatValeConfigError(configError, { withPath: true });
}

/**
 * Render a {@link ValeConfigError} as a sentence, shared by the whole-run
 * failure message ({@link describeValeStderr}) and the per-file finding
 * {@link parseErrorResult} builds for one excluded file.
 *
 * `withPath` exists because the two callers already say the file a different
 * way: the whole-run message has nowhere else to put it, so it is appended
 * here; a per-file finding already carries the file on `CheckResult.file`, and
 * repeating it inside `message` would be the same fact twice.
 */
function formatValeConfigError(
  error: ValeConfigError,
  options: { withPath: boolean }
): string {
  const text = error.Text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  // The code stays in the message, and is prepended only when `Text` does not
  // already open with it. Vale is inconsistent about that — `E100` repeats the
  // code in its text and `E201` does not — and the code is what a user searches
  // for, so losing it while "improving" the message would be a downgrade.
  const code = text.startsWith(error.Code) ? "" : `${error.Code}: `;
  const path =
    !options.withPath || error.Path === undefined || error.Path === ""
      ? ""
      : ` in ${error.Path}`;
  return `${code}${text}${path}`;
}

/**
 * The rule id a per-file parse failure is filed under.
 *
 * Not one of Vale's own checks — no style produced this finding, Vale never
 * finished parsing the file well enough to run one — but `CheckResult.ruleId`
 * has no slot for "no rule ran here, the file itself could not be read".
 * Namespaced so it reads as Vale's own report rather than a style violation,
 * and so a caller filtering by rule id can tell the two apart.
 */
const PARSE_ERROR_RULE_ID = "vale-parse-error";

/**
 * One file Vale could not parse, reported as a finding rather than aborting
 * the whole run.
 *
 * This is the fix for taskless/cli#300. Vale's own config-error payload
 * already names the file and the reason it failed to parse — that is what
 * {@link targetFileParseError} keys off of — so this only has to shape that
 * same information into the scanner-agnostic {@link CheckResult}, the same way
 * {@link toValeCheckResult} shapes an ordinary finding. `severity: "error"`
 * is deliberate: a file that could not be checked at all is not a clean pass,
 * and reporting it as anything softer would let it read as one.
 */
function parseErrorResult(file: string, error: ValeConfigError): CheckResult {
  const line = Math.max(0, (error.Line ?? 1) - 1);
  return {
    source: "vale",
    ruleId: PARSE_ERROR_RULE_ID,
    severity: "error",
    message: `Vale could not check this file: ${formatValeConfigError(error, { withPath: false })}`,
    file,
    range: {
      start: { line, column: 0 },
      end: { line, column: 0 },
    },
    matchedText: "",
  };
}

/**
 * Whether a Vale config-error names one of THIS RUN's target files — as
 * opposed to a rule file of ours, or a style Vale loaded through
 * `StylesPath`.
 *
 * The two are told apart by nothing more than what Vale's own error already
 * says, so this needs no YAML parser of its own to re-derive the distinction
 * (see the "Verify Build Output In The Build, Not By Parsing It" reasoning in
 * `STYLEGUIDE-CODE.md`, which extends to any generator or tool that has
 * already answered a question a second parser would only re-guess at). Vale
 * itself already parsed the file — that is why it is complaining — and its
 * error object already carries exactly which file and why.
 *
 * `assembleValeConfig` always writes `StylesPath` as an ABSOLUTE path (see
 * `stylesPath` in `verify.ts`, and `valeHeader` in `assemble.ts`), so a
 * problem Vale finds while loading a rule through that path reports an
 * absolute `Path`. A target file, by contrast, is named on Vale's command
 * line exactly as this module passed it — always relative to `cwd`, per
 * `targets` below — so a problem reading a target file reports the relative
 * path we asked Vale to check. Measured against the real binary, and pinned as
 * a vendor contract in `vale-vendor-contract.test.ts`: a bad `level:` in a rule
 * file reports that rule's absolute path on disk; an unquoted colon in a
 * document's front matter reports the relative path this module handed to
 * Vale.
 *
 * `isAbsolute` is therefore the WHOLE discriminator, deliberately with no
 * additional `.taskless/`-prefix carve-out. An earlier version of this
 * function also rejected any relative path starting with `.taskless/`, on the
 * theory that Taskless's own directory could not hold a legitimate target.
 * That reasoning was wrong: `verifyValeRule` (`verify.ts`) points `runVale`
 * explicitly at `.taskless/rules/vale/<ruleId>/rule-tests`, and `check` accepts
 * an explicit path under `.taskless/` and checks it (see
 * `mixed-engine-check.test.ts`, "still checks an explicitly named path inside
 * .taskless"). Neither call passes through the `.taskless/**` glob exclusion
 * below — that exclusion applies ONLY on a whole-project walk. A malformed
 * fixture under `rule-tests/` therefore reports a relative `Path` starting
 * with `.taskless/rules/vale/...`, which the old carve-out misread as "not a
 * target" — reintroducing the exact #300 failure on the one path meant to
 * catch it: `verifyValeRule` returned one blocking failure for the whole rule
 * instead of excluding just the bad fixture and reporting the rest.
 *
 * The existence check is defensive, not load-bearing: if it is ever wrong for
 * a real target file, the failure mode is "this file could not be excluded,
 * the run reports the ordinary blocking failure" — never a bad exclusion.
 */
async function targetFileParseError(
  error: ValeConfigError,
  cwd: string
): Promise<string | undefined> {
  const path = error.Path;
  if (path === undefined || path === "" || isAbsolute(path)) {
    return undefined;
  }
  try {
    const stats = await stat(resolvePath(cwd, path));
    if (!stats.isFile()) return undefined;
  } catch {
    return undefined;
  }
  return path;
}

/** One Vale invocation's outcome, before the retry loop in {@link runVale}
 * decides what to do about it.
 *
 * A narrower shape than {@link ValeRunOutcome}: `unavailable` cannot happen
 * here (the caller already checked for a binary before ever attempting a run),
 * and a `failed` attempt carries the parsed {@link ValeConfigError} when Vale's
 * failure had that shape, so the retry loop can ask {@link targetFileParseError}
 * whether this attempt can be narrowed and tried again — without re-parsing the
 * message it also carries.
 */
type ValeAttempt =
  | { status: "ok"; results: CheckResult[]; notice?: string }
  | { status: "timeout"; message: string }
  | { status: "failed"; message: string; configError?: ValeConfigError };

/**
 * Spawn Vale once and map what it reports. Extracted from {@link runVale} so
 * the retry loop there can call it again with a wider exclusion glob after
 * dropping one file that could not be parsed.
 */
async function spawnVale(
  binary: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
  skipped: string | undefined
): Promise<ValeAttempt> {
  return new Promise<ValeAttempt>((settlePromise) => {
    const child = spawn(binary, argv, {
      cwd,
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
    const settle = (outcome: ValeAttempt): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settlePromise(outcome);
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
        const configError = parseValeConfigError(stderr);
        settle({
          status: "failed",
          message: `Vale exited ${String(code)}${
            stderr === "" ? "" : `: ${describeValeStderr(stderr, configError)}`
          }`,
          ...(configError === undefined ? {} : { configError }),
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
        settle({ status: "ok", results: [], ...notice });
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
            message: `Vale rejected the configuration: ${formatValeConfigError(configError, { withPath: true })}`,
            configError,
          });
          return;
        }

        settle({
          status: "ok",
          results: toValeCheckResults(parsed as ValeOutput),
          ...notice,
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
  //
  // Started together with the converter-dependent scan below, because neither
  // answer feeds the other: the ignore list shapes the `--glob` argument, the
  // scan shapes the skipped-files notice, and only the `.filter` further down
  // ever brings the two together. Awaited in series they would charge every
  // whole-project run a git subprocess and then a directory walk, back to
  // back, before the Vale subprocess has even been spawned.
  //
  // The notice half of that pair is asked before the run rather than inferred
  // from it. Vale never reports what its walker declined to open, so once the
  // glob has done its job the skipped files are unrecoverable from the output,
  // and a fix whose only visible effect is that some findings are quietly
  // missing is the bug it replaced.
  //
  // The ignored paths are filtered back out for the same reason the notice
  // exists at all: it must describe the run that happened. An `.adoc` inside
  // `worktrees/` is not a file this run declined to convert, it is a file this
  // run was never going to look at, and naming it would send the reader to
  // investigate a directory the fix above deliberately excluded.
  const [ignoredEntries, converterDependent, oversized] = await Promise.all([
    wholeProject ? listGitIgnoredEntries(options.cwd) : [],
    findConverterDependentFiles(options.cwd, paths),
    findOversizedFiles(options.cwd, paths, VALE_MAX_FILE_BYTES),
  ]);

  // A file too large to check safely is excluded the same way, and for the
  // same reason, as a converter-dependent one just above: unconditionally, on
  // every run, named path or not. Handing it to Vale does not check it
  // badly — Vale's quadratic cost on one large file can consume the whole
  // run's timeout, taking every other file's findings with it (taskless/cli#321).
  const oversizedInScope = oversized.filter(
    (entry) => !isGitIgnoredPath(entry.file, ignoredEntries)
  );

  const exclude = [
    ...(wholeProject
      ? [
          `${TASKLESS_DIRECTORY}/**`,
          ...gitIgnoredExclusionGlobs(ignoredEntries),
        ]
      : []),
    ...converterExclusionGlobs(),
    ...oversizedInScope.map((entry) => entry.file),
  ];

  // Both notices describe files this run declined to check, for different
  // reasons, and both have to reach the user or the decline is silent. Joined
  // rather than one overwriting the other — see the equivalent `advisories`
  // join for Vale's own stderr diagnostic further down, for the same reason.
  const notices = [
    skippedFilesNotice(
      converterDependent.filter(
        (file) => !isGitIgnoredPath(file, ignoredEntries)
      )
    ),
    oversizedFilesNotice(oversizedInScope, VALE_MAX_FILE_BYTES),
  ].filter((notice) => notice !== undefined);
  const skipped = notices.length === 0 ? undefined : notices.join("\n");

  // One bad target file must cost one finding, not the whole run
  // (taskless/cli#300). A front-matter YAML error is Vale's own parse
  // failure, not a rejected rule config, and it aborts the whole invocation
  // before any result is written — exactly like the converter-dependent
  // crash above, and for the same reason: nothing about it is scoped to the
  // one file that triggered it. Unlike that case there is no format to
  // preemptively exclude; which file is bad is only known once Vale says so.
  //
  // So this retries: on a failure Vale's own error object attributes to one
  // of *our* target files (`targetFileParseError`), that file is added to the
  // exclusion glob and the whole thing is asked again, with a finding
  // recorded for the file that was dropped. A failure that cannot be
  // attributed to a single target file — a bad rule, a timeout, a crash — is
  // not this bug, and is reported exactly as before: blocking, with nothing
  // to retry around.
  //
  // Bounded by construction rather than by a counter: every successful
  // iteration excludes one target file that was not already excluded, and
  // there are finitely many files to exclude. Re-reporting the same path
  // twice in a row is the only way this could spin, and that path is refused
  // rather than retried (see the `excludedTargets.has` check below).
  const excludedTargets = new Set<string>();
  const excludedFindings: CheckResult[] = [];

  for (;;) {
    const globArgument = buildValeGlob([...exclude, ...excludedTargets]);
    const globFlags = globArgument === undefined ? [] : [globArgument];

    // `--` separates flags from positional paths, so a path beginning with
    // `-` is not read as a flag.
    const argv = [
      "--config",
      configPath,
      "--output=JSON",
      "--no-exit",
      ...globFlags,
      "--",
      ...targets,
    ];

    const attempt = await spawnVale(
      binary,
      argv,
      options.cwd,
      timeoutMs,
      skipped
    );

    if (attempt.status === "ok") {
      return {
        status: "ok",
        blocking: false,
        results: [...excludedFindings, ...attempt.results],
        ...(attempt.notice === undefined ? {} : { notice: attempt.notice }),
      };
    }

    if (attempt.status === "timeout") {
      return { status: "timeout", blocking: true, message: attempt.message };
    }

    const { configError } = attempt;
    const candidate =
      configError === undefined
        ? undefined
        : await targetFileParseError(configError, options.cwd);

    if (candidate === undefined || configError === undefined) {
      return { status: "failed", blocking: true, message: attempt.message };
    }
    if (excludedTargets.has(candidate)) {
      return { status: "failed", blocking: true, message: attempt.message };
    }

    excludedTargets.add(candidate);
    excludedFindings.push(parseErrorResult(candidate, configError));
  }
}

/** Absolute path of the committed Vale config for `cwd`. */
export function valeConfigPath(cwd: string): string {
  return join(cwd, ASSEMBLED_VALE_CONFIG);
}
