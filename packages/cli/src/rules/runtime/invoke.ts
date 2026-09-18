import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import type { Finding, Match } from "../../types/runtime-rule";

/** Default per-check wall-clock bound (ms); overridable via `--timeout`. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

/** Outcome of invoking a single `check.ts`. */
export type InvokeResult =
  | { status: "ok"; findings: Finding[] }
  | { status: "error"; message: string };

/**
 * The self-contained ESM runner executed under `tsx`. It imports the delivered
 * `check.ts` (which `tsx` transpiles), calls its default export with
 * `(root, matches)`, and writes the returned findings to `outPath` — so the
 * check's own stdout/stderr never pollutes the result channel.
 */
const RUNNER_SOURCE = `import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [checkFile, root, matchesPath, outPath] = process.argv.slice(2);
try {
  const matches = JSON.parse(readFileSync(matchesPath, "utf8"));
  const mod = await import(pathToFileURL(checkFile).href);
  const check = mod.default;
  if (typeof check !== "function") {
    throw new TypeError("check.ts must export a default function");
  }
  const findings = await check(root, matches);
  writeFileSync(outPath, JSON.stringify(findings ?? []));
} catch (error) {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
}
`;

/** Resolve the bundled `tsx` CLI entry so `check.ts` runs without a repo toolchain. */
function resolveTsxCli(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("tsx/package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const binField = packageJson.bin;
  const relative = typeof binField === "string" ? binField : binField?.tsx;
  if (!relative) {
    throw new Error("Bundled tsx has no resolvable bin entry");
  }
  return resolve(dirname(packageJsonPath), relative);
}

/**
 * Invoke a runtime rule's `check.ts` as a function and return its findings.
 * Bounds execution with `timeoutMs`; a throw, a non-zero exit, or a timeout is
 * isolated into an `error` result (the caller records one error-severity finding)
 * and never aborts the overall run.
 */
export async function invokeCheck(
  checkFile: string,
  root: string,
  matches: Match[],
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS
): Promise<InvokeResult> {
  let tsxCli: string;
  try {
    tsxCli = resolveTsxCli();
  } catch (error) {
    return {
      status: "error",
      message: `runtime harness unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const workDirectory = await mkdtemp(join(tmpdir(), "tskl-check-"));
  const matchesPath = join(workDirectory, "matches.json");
  const runnerPath = join(workDirectory, "runner.mjs");
  const outPath = join(workDirectory, "findings.json");

  try {
    await writeFile(matchesPath, JSON.stringify(matches));
    await writeFile(runnerPath, RUNNER_SOURCE);

    const result = await new Promise<InvokeResult>((resolvePromise) => {
      // `detached` makes the child its own process-group leader so a timeout
      // can SIGKILL the whole tree — `tsx` re-execs node as a grandchild, and
      // killing only the wrapper would leave a runaway check running.
      const child = spawn(
        process.execPath,
        [tsxCli, runnerPath, checkFile, root, matchesPath, outPath],
        { stdio: ["ignore", "ignore", "pipe"], detached: true }
      );
      const stderrChunks: string[] = [];
      let timedOut = false;
      const killTree = () => {
        if (child.pid === undefined) return;
        if (process.platform === "win32") {
          // Negative PIDs aren't supported on Windows; `taskkill /T` terminates
          // the whole tree (the tsx wrapper and its re-exec'd node grandchild).
          try {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
          } catch {
            child.kill("SIGKILL");
          }
          return;
        }
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);

      child.stderr.on("data", (chunk: Buffer) =>
        stderrChunks.push(chunk.toString())
      );
      child.on("error", (error) => {
        clearTimeout(timer);
        resolvePromise({ status: "error", message: error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolvePromise({
            status: "error",
            message: `check timed out after ${String(timeoutMs)}ms`,
          });
          return;
        }
        if (code !== 0) {
          const detail = stderrChunks.join("").trim();
          resolvePromise({
            status: "error",
            message: `check exited with code ${String(code)}${
              detail ? `: ${detail}` : ""
            }`,
          });
          return;
        }
        void readFile(outPath, "utf8")
          .then((raw) =>
            resolvePromise({
              status: "ok",
              findings: JSON.parse(raw) as Finding[],
            })
          )
          .catch((error: unknown) =>
            resolvePromise({
              status: "error",
              message: `check produced no readable findings: ${
                error instanceof Error ? error.message : String(error)
              }`,
            })
          );
      });
    });
    return result;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
