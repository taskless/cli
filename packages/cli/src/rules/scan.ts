import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { AstGrepMatch } from "../types/check";
import { toCheckResult, type CheckResult } from "../types/check";

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

/** The npm package carrying this host's prebuilt ast-grep binary. */
function platformPackageName(): string {
  const parts: string[] = [process.platform, process.arch];
  if (process.platform === "linux") {
    parts.push("gnu");
  } else if (process.platform === "win32") {
    parts.push("msvc");
  }
  return `@ast-grep/cli-${parts.join("-")}`;
}

/** Absolute path to the binary inside the resolved platform package, if any. */
function platformPackageBinary(binary: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(
      `${platformPackageName()}/package.json`
    );
    return resolve(dirname(packageJsonPath), binary);
  } catch {
    // Not installed for this host (unsupported arch, or musl — upstream
    // publishes no musl package and marks the gnu ones `libc: [glibc]`).
    return undefined;
  }
}

/** First entry on PATH that holds an executable named `command`. */
function findOnPath(command: string): string | undefined {
  const separator = process.platform === "win32" ? ";" : ":";
  for (const directory of (process.env.PATH ?? "").split(separator)) {
    if (directory === "") continue;
    const candidate = resolve(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
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
 * linked binary, then whatever the host provides. If every candidate misses
 * there is no ast-grep, and we say so plainly rather than handing a bare
 * command name to spawn and letting ENOENT explain it.
 */
export function findSgBinary(): string {
  const binary = process.platform === "win32" ? "ast-grep.exe" : "ast-grep";
  const alternative = process.platform === "win32" ? "sg.exe" : "sg";
  const localBin = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".bin"
  );

  const candidates: Array<[label: string, path: string | undefined]> = [
    [platformPackageName(), platformPackageBinary(binary)],
    ["node_modules/.bin", resolve(localBin, alternative)],
    ["PATH", findOnPath(alternative)],
    ["PATH", findOnPath(binary)],
  ];

  for (const [, path] of candidates) {
    if (path !== undefined && existsSync(path)) return path;
  }

  const tried = candidates.map(([label]) => label).join(", ");
  throw new Error(
    `ast-grep binary not found. Looked in: ${tried}. Install a supported ` +
      `platform build, or put \`${alternative}\` on your PATH.`
  );
}

/** Run ast-grep scan and return parsed results */
export async function runAstGrepScan(
  cwd: string,
  paths: string[] = []
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sgBinary = findSgBinary();
    // Use `--` to separate sg's flags from positional paths so that paths
    // beginning with `-` (unusual but valid) aren't misparsed as flags.
    const argv = [
      "scan",
      "--config",
      ".taskless/sgconfig.yml",
      "--json=stream",
      ...(paths.length > 0 ? ["--", ...paths] : []),
    ];
    const child = spawn(sgBinary, argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildPath() },
    });

    const results: CheckResult[] = [];
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
      stderrChunks.push(chunk.toString());
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            "ast-grep (sg) binary not found. Is @ast-grep/cli installed?"
          )
        );
      } else {
        reject(error);
      }
    });

    child.on("close", (code) => {
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
