import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

import type { AstGrepMatch } from "../types/check";
import { toCheckResult, type CheckResult } from "../types/check";
import { ASSEMBLED_SG_CONFIG } from "./engines";
import {
  isPlatformBinary,
  pathCommandName,
  resolvePlatformBinary,
  type PlatformBinarySpec,
} from "./platform-binary";

export interface ScanResult {
  results: CheckResult[];
  exitCode: number;
}

/**
 * Build PATH that includes this package's node_modules/.bin, for processes we
 * spawn.
 *
 * This no longer participates in locating ast-grep — {@link findSgBinary}
 * searches candidate locations explicitly and returns an absolute path. It is
 * kept because it shapes the *child* process's environment, which is a separate
 * concern from how we found the binary.
 */
export function buildPath(): string {
  const thisDirectory = dirname(fileURLToPath(import.meta.url));
  const binDirectory = resolve(thisDirectory, "..", "node_modules", ".bin");
  const separator = process.platform === "win32" ? ";" : ":";
  return `${binDirectory}${separator}${process.env.PATH ?? ""}`;
}

/**
 * ast-grep's per-platform packaging, as the shared resolver understands it.
 *
 * `toolchainSuffix: true` is what produces `@ast-grep/cli-linux-x64-gnu` and
 * `-win32-x64-msvc`. The Vale packages set it false; see
 * {@link PlatformBinarySpec} for why that distinction is load-bearing.
 *
 * Both `ast-grep` and `sg` are listed because the wrapper declares them as bin
 * entries for the same target, so either may be what got linked. `ast-grep`
 * leads because it is the name the platform package ships the binary under; the
 * resolver reverses the list at the link-based tiers, so `sg` is still tried
 * first there and named in the PATH advice, as it was before the shared
 * resolver existed.
 */
export const AST_GREP_BINARY: PlatformBinarySpec = {
  label: "ast-grep",
  packagePrefix: "@ast-grep/cli",
  toolchainSuffix: true,
  binaryNames: ["ast-grep", "sg"],
  identity: /ast-grep/i,
};

/**
 * Whether `path` is really ast-grep, established by running it.
 *
 * Existence is not enough. The `@ast-grep/cli` wrapper's postinstall leaves a
 * **placeholder text file** at the binary's path when its hardlink fails under
 * pnpm dlx's strict isolation — the exact failure this resolver exists to route
 * around, and one that an `existsSync` check accepts happily. Asking the
 * candidate to identify itself is the only check that distinguishes the real
 * binary from a file merely sitting where the binary belongs.
 */
export function isAstGrepBinary(path: string): boolean {
  return isPlatformBinary(AST_GREP_BINARY, path);
}

/**
 * Resolve the ast-grep binary, searching every place it could reasonably live
 * before giving up.
 *
 * We never rely on an install-time step to put the binary somewhere: the CLI
 * depends on the per-platform packages directly and executes by path. That
 * matters because the `@ast-grep/cli` wrapper's postinstall hardlink fails
 * under pnpm dlx's strict isolation, leaving a placeholder text file where the
 * binary should be.
 *
 * Candidates are ordered by confidence, not by quality of outcome — the
 * platform package first because it is the version we pinned, then a locally
 * linked binary, then whatever the host provides. Each is verified by running
 * it ({@link isAstGrepBinary}), so a file sitting at the right path but not
 * actually ast-grep is skipped rather than executed. If every candidate misses
 * there is no ast-grep, and we say so plainly rather than handing a bare
 * command name to spawn and letting ENOENT explain it.
 *
 * The result is cached for the process: the search spawns a subprocess per
 * candidate, and callers resolve once per rule.
 */
let cachedSgBinary: string | undefined;

export function findSgBinary(): string {
  if (cachedSgBinary !== undefined) return cachedSgBinary;

  const { path, tried } = resolvePlatformBinary(AST_GREP_BINARY);
  if (path !== undefined) {
    cachedSgBinary = path;
    return path;
  }

  // ast-grep, unlike Vale, has no degraded mode: it is the executor for every
  // `sg` rule, so a miss is fatal for this command rather than one engine
  // reporting itself unavailable.
  //
  // The PATH advice is spelled for the platform — `sg.exe` on Windows — rather
  // than hardcoded, so a Windows user is not told to install a name that would
  // not be found there.
  throw new Error(
    `ast-grep binary not found. Looked in: ${tried.join(", ")}. Install a ` +
      `supported platform build, or put \`${pathCommandName(AST_GREP_BINARY)}\` on your PATH.`
  );
}

export interface ScanOptions {
  /**
   * ast-grep config to scan with, relative to `cwd`. Defaults to the committed
   * `sg` engine config — the source of truth for the ast-grep engine, read
   * as-is rather than generated per run. Callers scanning the pre-migration
   * layout pass the ephemeral config written for it instead.
   */
  configPath?: string;
}

/**
 * The project directory this CLI owns. Declared locally rather than imported
 * from the Vale runner, which keeps its own copy for the same reason.
 */
const TASKLESS_DIRECTORY = ".taskless";

/**
 * How every `sg scan` we spawn is told to walk the project.
 *
 * One function rather than a constant per call site, because both scan call
 * sites — {@link runAstGrepScan} and the runtime narrow — need exactly these
 * flags on exactly these terms, and a third would too. ast-grep's
 * `sgconfig.yml` has no equivalent knob, so this cannot live in the assembled
 * config; the argv is the only place it can be expressed.
 *
 * **`--no-ignore hidden`**, always. It lets the walker descend into
 * dot-directories, which it refuses to do by default. Without it no `sg` rule
 * could match anything under `.github/`, `.circleci/`, `.vscode/` or
 * `.husky/` — a silent false negative, since `check` reported nothing and
 * exited 0. Vale has no such blind spot, so the two static engines disagreed
 * about whether `.github/` existed at all. Measured against the pinned ast-grep
 * 0.41.0, `hidden` is the only value that reaches those directories: `dot`,
 * `exclude`, `global` and `parent` all left `.github/` unscanned. Deliberately
 * **not** passed is `vcs`, which stops `.gitignore` being respected and was
 * measured to pull `dist/` into the scan — a rule has no business reporting
 * findings in build output or vendored dependencies.
 *
 * **A `--globs` exclusion of `.taskless/`**, when we are the ones who chose to
 * walk the whole project. That directory is hidden, so it was never scanned
 * before and reaching it is not a fix: it is CLI-managed config the user did
 * not author. Every rule definition in it is structured YAML carrying `id:`,
 * `language:`, `severity:`, `message:` and `rule:` keys, so any reasonable
 * user-written Yaml rule fires on the CLI's own rule files — an unfixable false
 * positive in a directory the user cannot edit without disabling their rule.
 * The `**` prefix on the glob is load-bearing: a root-anchored `.taskless/**`
 * was measured to miss a `.taskless/` nested inside a monorepo package, which
 * is the same CLI-managed config one level down.
 *
 * The exclusion is applied **only** for a whole-project scan, matching what the
 * Vale runner already does and for its reason: an explicit path is a request,
 * and silently declining to check a file someone named would be worse than
 * checking one they did not.
 *
 * Measured interactions worth keeping in mind if this is ever changed:
 * `--globs` survives `--no-ignore hidden` rather than being overridden by it,
 * and neither flag touches rule discovery — `ruleDirs` reads the rules out of
 * `.taskless/` by its own walk, so excluding that path from the *scan* does not
 * stop the rules from loading, and a rule's `.tests/` directory is still
 * skipped rather than parsed as a rule (see `RULE_TESTS_DIRECTORY` in
 * `engines.ts`).
 */
export function sgWalkArgv(paths: string[]): string[] {
  const exclude =
    paths.length === 0 ? ["--globs", `!**/${TASKLESS_DIRECTORY}/**`] : [];
  return ["--no-ignore", "hidden", ...exclude];
}

/** Run ast-grep scan and return parsed results */
export async function runAstGrepScan(
  cwd: string,
  paths: string[] = [],
  options: ScanOptions = {}
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sgBinary = findSgBinary();
    // Use `--` to separate sg's flags from positional paths so that paths
    // beginning with `-` (unusual but valid) aren't misparsed as flags.
    const argv = [
      "scan",
      "--config",
      options.configPath ?? ASSEMBLED_SG_CONFIG,
      "--json=stream",
      ...sgWalkArgv(paths),
      ...(paths.length > 0 ? ["--", ...paths] : []),
    ];
    const child = spawn(sgBinary, argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildPath() },
    });

    const results: CheckResult[] = [];

    // One decoder for the stream, not `chunk.toString()` per chunk. A
    // multi-byte UTF-8 sequence split across a chunk boundary would otherwise
    // have each half independently replaced with U+FFFD, and the bytes are
    // unrecoverable by the time the pieces are joined. What ast-grep writes
    // here is the message a user reads when it rejects a rule file — naming a
    // rule id or a path, which is exactly where a non-ASCII character shows up.
    // Same treatment `vale/run.ts` and `verify.ts` already give their streams.
    //
    // stdout needs no decoder: it is consumed through `node:readline`, which
    // handles character boundaries itself.
    const stderrDecoder = new StringDecoder("utf8");
    const stderrChunks: string[] = [];

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      try {
        const match = JSON.parse(trimmed) as AstGrepMatch;
        results.push(toCheckResult(match));
      } catch {
        // Skip non-JSON lines (e.g. ast-grep status messages)
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(stderrDecoder.write(chunk));
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        // Near-unreachable: findSgBinary verifies the candidate by running it
        // before we get here. Reachable only if the binary disappears between
        // resolution and spawn, so the message names that, not a package.
        reject(
          new Error(
            `ast-grep binary vanished between resolution and execution: ${sgBinary}`
          )
        );
      } else {
        reject(error);
      }
    });

    child.on("close", (code) => {
      // Flush whatever partial multi-byte sequence the decoder is holding, so a
      // stream that ends mid-character contributes its replacement char once
      // rather than leaving bytes unaccounted for.
      stderrChunks.push(stderrDecoder.end());

      // ast-grep exits 1 when error-severity matches found — that's expected
      // Only treat spawn/binary failures (exit > 1) as errors
      if (code !== null && code > 1) {
        const stderr = stderrChunks.join("");
        reject(
          new Error(
            `ast-grep scan failed with exit code ${String(code)}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
        return;
      }
      resolve({ results, exitCode: code ?? 0 });
    });
  });
}
