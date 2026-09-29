import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";

/**
 * The transient verification space one `check` (or `rule restore`) works in:
 * `.taskless/.run/<runId>/`.
 *
 * **One directory per run.** A single shared snapshot let a second `check`
 * delete and re-copy the tree a first one was still reading, so the first
 * could run a half-copied tree, or a copy whose signatures it never checked,
 * which is exactly what the snapshot exists to prevent. A pre-commit hook
 * firing during an editor's on-save `check` is enough.
 *
 * **Always removed**, on success, on failure, and on SIGINT/SIGTERM (best
 * effort), unless `--preserve-logs` asks to keep it. What it holds is the copy
 * that ran and the logs of running it, which is what debugging a run needs and
 * nothing a later run reads.
 *
 * **Abandoned directories are swept** at the start of every run: a run killed
 * with SIGKILL never gets to clean up. A directory is abandoned when the
 * process named in its `owner` file is gone on this host. Age is not the test,
 * because it would either delete a slow run still in progress or keep junk for
 * hours. A directory owned by another host (a shared filesystem) is left
 * alone, since this host cannot tell whether that process lives. A directory
 * whose name is not a run id predates run ids (0.11's `runtime-rules/`, the
 * first 0.12 `snapshot/`) and is swept too. A run-id directory with no `owner`
 * is swept only after a grace period, because that is also what a run looks
 * like in the instant between creating its directory and recording its owner.
 */

/** `.taskless/.run`, relative to the project root. */
const RUN_ROOT = join(".taskless", ".run");

/** A run id, as {@link newRunId} makes them. */
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;

/**
 * How long a run-id directory may go without an `owner` record before it
 * counts as abandoned. A run creates its directory and writes its owner as two
 * steps, so for an instant a LIVE run has no owner; a sweep landing there must
 * leave it alone. Measured: four concurrent `check`s swept each other's
 * directories when ownerless meant abandoned. A run killed inside that instant
 * is caught by the next sweep after this grace.
 */
const OWNERLESS_GRACE_MS = 60_000;

/**
 * How long a signal waits for a preserved run's logs to reach the disk before
 * re-raising anyway.
 */
const SIGNAL_FLUSH_MS = 2000;

/** Who is using a run directory, so a later run can tell if it was abandoned. */
interface Owner {
  pid: number;
  hostname: string;
  startedAt: string;
}

/** One append-only log file in a run directory. */
export class RunLog {
  private pending: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {}

  /** Append one timestamped entry. Never throws: a log must not fail a run. */
  write(text: string): void {
    const entry = `[${new Date().toISOString()}] ${text}\n`;
    this.pending = this.pending
      .then(() => appendFile(this.path, entry, "utf8"))
      .catch(() => {});
  }

  /** Wait for every entry written so far to reach the disk. */
  flush(): Promise<void> {
    return this.pending;
  }
}

/** The logs of one run. */
export interface RunLogs {
  /** The plan: what was copied, reported, judged, excluded, and run. */
  engine: RunLog;
  /** ast-grep's command line, output, and exit code. */
  sg: RunLog;
  /** Vale's command line, output, and exit code, per attempt. */
  vale: RunLog;
  /** Per runtime rule: duration, findings, and any error. */
  runtime: RunLog;
}

export interface RunDirectory {
  /** `<timestamp>-<random>`: sortable by start time, unique across runs. */
  id: string;
  /** Absolute path of `.taskless/.run/<runId>/`. */
  path: string;
  /** The path relative to the project root, for printing. */
  relativePath: string;
  logs: RunLogs;
  /**
   * Remove the directory, unless it is being preserved. Idempotent. Always
   * call it, in a `finally`.
   */
  close(): Promise<void>;
}

export interface OpenRunOptions {
  /** Keep the directory after the run (`--preserve-logs`). */
  preserve?: boolean;
}

function newRunId(now: Date): string {
  const stamp = now.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d+/, "");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

/** Whether `pid` names a live process on this host. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(directory: string): Promise<Owner | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directory, "owner"), "utf8")
    ) as Partial<Owner>;
    return typeof parsed.pid === "number" && typeof parsed.hostname === "string"
      ? (parsed as Owner)
      : undefined;
  } catch {
    return undefined;
  }
}

async function olderThan(path: string, ms: number): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(path);
    return Date.now() - mtimeMs > ms;
  } catch {
    return false;
  }
}

/**
 * Remove every run directory whose owner is gone. Returns what was removed,
 * for the engine log. Never throws: a sweep that cannot finish leaves junk,
 * which is not a reason to fail a run.
 */
export async function sweepAbandonedRuns(cwd: string): Promise<string[]> {
  const root = join(cwd, RUN_ROOT);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const owner = await readOwner(directory);
    if (owner !== undefined) {
      if (owner.hostname !== hostname()) continue;
      if (isAlive(owner.pid)) continue;
    } else if (
      // A run id with no owner yet is most likely a run starting right now.
      RUN_ID.test(entry.name) &&
      !(await olderThan(directory, OWNERLESS_GRACE_MS))
    ) {
      continue;
    }
    try {
      await rm(directory, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // Left for the next sweep.
    }
  }
  return removed;
}

/**
 * Create this run's directory, after sweeping abandoned ones.
 */
export async function openRun(
  cwd: string,
  options: OpenRunOptions = {}
): Promise<RunDirectory> {
  const swept = await sweepAbandonedRuns(cwd);

  const root = join(cwd, RUN_ROOT);
  await mkdir(root, { recursive: true });
  // The run root ignores itself, so `check` never rewrites a tracked file.
  // Written only when missing: concurrent runs would otherwise race on it.
  await writeFile(join(root, ".gitignore"), "*\n", { flag: "wx" }).catch(
    () => {}
  );

  const now = new Date();
  const id = newRunId(now);
  const path = join(root, id);
  await mkdir(path, { recursive: true });
  const owner: Owner = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: now.toISOString(),
  };
  await writeFile(join(path, "owner"), `${JSON.stringify(owner)}\n`, "utf8");

  const logs: RunLogs = {
    engine: new RunLog(join(path, "engine.log")),
    sg: new RunLog(join(path, "sg.log")),
    vale: new RunLog(join(path, "vale.log")),
    runtime: new RunLog(join(path, "runtime.log")),
  };
  logs.engine.write(`run ${id} started (pid ${String(process.pid)})`);
  if (swept.length > 0) {
    logs.engine.write(`swept abandoned run directories: ${swept.join(", ")}`);
  }

  const preserve = options.preserve === true;
  let closed = false;

  // A signal skips `finally`, so the directory would outlive the run. Removed
  // synchronously, then the signal re-raised so the process still exits the
  // way the signal asked.
  //
  // A preserved directory is kept for its logs, and `RunLog.write` only
  // queues: re-raising at once, with no handler left, terminates before the
  // queued appends land. Measured: 1 of 52 engine entries survived. So a
  // preserved run flushes first, bounded, since a hung disk must not turn
  // Ctrl-C into a hang. A second signal meanwhile finds no handler and
  // terminates at once, which is what pressing it twice should do.
  const onSignal = (signal: NodeJS.Signals): void => {
    const wasClosed = closed;
    closed = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    const reraise = (): void => {
      process.kill(process.pid, signal);
    };
    if (wasClosed) {
      reraise();
      return;
    }
    if (!preserve) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // The next run's sweep removes it.
      }
      reraise();
      return;
    }
    logs.engine.write(`run interrupted by ${signal}; directory preserved`);
    void Promise.race([
      Promise.all(
        [logs.engine, logs.sg, logs.vale, logs.runtime].map((log) =>
          log.flush()
        )
      ),
      new Promise((resolve) => setTimeout(resolve, SIGNAL_FLUSH_MS).unref()),
    ]).finally(reraise);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return {
    id,
    path,
    relativePath: relative(cwd, path),
    logs,
    async close() {
      if (closed) return;
      closed = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      logs.engine.write(
        preserve ? "run finished; directory preserved" : "run finished"
      );
      await Promise.all(
        [logs.engine, logs.sg, logs.vale, logs.runtime].map((log) =>
          log.flush()
        )
      );
      if (preserve) return;
      // `close` runs in a `finally` after the run's output is written, so a
      // throw here would replace a finished run's exit code with a crash.
      // `force` only forgives a missing path; EBUSY or EPERM from a child
      // still letting go of a file must be forgiven too.
      try {
        await rm(path, { recursive: true, force: true });
      } catch {
        // The next run's sweep removes it.
      }
    },
  };
}
