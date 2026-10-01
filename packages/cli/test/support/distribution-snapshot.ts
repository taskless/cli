import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import type { TestProject } from "vitest/node";

/**
 * Vitest global setup: snapshot `dist/` once per run, and run every spawned CLI
 * from the snapshot instead of from `dist/` itself.
 *
 * WHY THIS EXISTS. taskless/cli#262: spawning tests failed once on a full-suite
 * run and passed on an immediate rerun. `vitest run` does not build, so every
 * spawn reads whatever `dist/` holds at that moment, and a build that starts
 * mid-run (`pnpm lint` builds first) empties `dist/` before rewriting it.
 * Measured: 22 of 343 spawns of `auth login --anonymous` failed while six
 * builds ran alongside, each with exit code 1, empty stdout, and `Cannot find
 * module …/dist/index.js`; 0 of 414 failed with no build running. Exit code 1
 * and empty stdout is exactly what both reported tests choke on.
 *
 * WHY HERE AND NOT IN `os.tmpdir()`. The bundle finds tsx, ast-grep and Vale
 * relative to its own file, through `createRequire(import.meta.url)`, which
 * walks up to `packages/cli/node_modules`. Outside the package that walk finds
 * nothing (measured: both `tsx` and `@ast-grep/cli` unresolvable from a tmpdir
 * copy), and tests would silently exercise whatever is on PATH instead. Under
 * `packages/cli/tmp/` the walk still lands where it does from `dist/`. `tmp` is
 * gitignored at any depth.
 *
 * One directory per run, named for the vitest process that owns it, so two
 * runs in the same checkout never share or sweep each other's snapshot.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(PACKAGE_ROOT, "dist");
const SNAPSHOT_ROOT = join(PACKAGE_ROOT, "tmp", "dist-test");

/** Attempts at a copy that no build disturbed, before giving up. */
const COPY_ATTEMPTS = 5;
const COPY_RETRY_MS = 500;

declare module "vitest" {
  export interface ProvidedContext {
    /** Absolute path to this run's snapshot of `dist/`. */
    cliDist: string;
  }
}

/** Whether a process with this id is still running. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Remove snapshots left by runs that exited without tearing down. */
async function sweepStaleSnapshots(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(SNAPSHOT_ROOT);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const pid = Number.parseInt(entry.split("-")[0] ?? "", 10);
      if (Number.isInteger(pid) && isAlive(pid)) return;
      await rm(join(SNAPSHOT_ROOT, entry), { recursive: true, force: true });
    })
  );
}

/**
 * Every file under `dist/` with its size and mtime. Equal before and after a
 * copy means no build wrote to `dist/` while it was being read.
 */
async function fingerprint(directory: string): Promise<string> {
  const files = await readdir(directory, { recursive: true });
  const lines = await Promise.all(
    files.map(async (file) => {
      const info = await stat(join(directory, file));
      return `${file}:${info.size}:${info.mtimeMs}`;
    })
  );
  return lines.toSorted().join("\n");
}

async function snapshotDistribution(target: string): Promise<void> {
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt++) {
    if (existsSync(join(DIST, "index.js"))) {
      try {
        const before = await fingerprint(DIST);
        await cp(DIST, target, { recursive: true });
        if ((await fingerprint(DIST)) === before) return;
      } catch {
        // A build removed a file mid-copy. Same outcome as a changed
        // fingerprint: start again from an empty target.
      }
      await rm(target, { recursive: true, force: true });
    }
    await delay(COPY_RETRY_MS);
  }
  throw new Error(
    existsSync(join(DIST, "index.js"))
      ? `${relative(process.cwd(), DIST)}/ kept changing while it was being ` +
          `copied for this test run. A build is probably running; wait for it ` +
          `to finish and rerun.`
      : `${relative(process.cwd(), DIST)}/index.js does not exist. Most of this ` +
          `suite spawns the built CLI: run \`pnpm build\` first.`
  );
}

export default async function setup(project: TestProject) {
  await sweepStaleSnapshots();
  await mkdir(SNAPSHOT_ROOT, { recursive: true });
  const snapshot = await mkdtemp(join(SNAPSHOT_ROOT, `${process.pid}-`));
  await snapshotDistribution(snapshot);
  project.provide("cliDist", snapshot);

  return async () => {
    await rm(snapshot, { recursive: true, force: true });
  };
}
