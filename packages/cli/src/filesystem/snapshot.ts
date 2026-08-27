import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * What a migration run did to the working tree, as paths relative to the
 * project root. Every list is sorted, so two runs over the same tree produce
 * byte-identical output.
 */
export interface TreeChanges {
  added: string[];
  modified: string[];
  removed: string[];
}

/** Content hash of one file, or `undefined` when it cannot be read. */
async function hashFile(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    // Missing, or a special file we have no business hashing. Either way it
    // is not part of the snapshot.
    return undefined;
  }
}

async function walk(
  projectRoot: string,
  absolute: string,
  into: Map<string, string>
): Promise<void> {
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    // Not a directory, or not there. `snapshotPaths` handles the file case.
    return;
  }
  for (const entry of entries) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      await walk(projectRoot, child, into);
      continue;
    }
    // A symlink is recorded by its TARGET PATH rather than by following it.
    // `Dirent` predicates describe the entry itself, so a symlink is neither
    // a file nor a directory here and would otherwise be invisible in both
    // snapshots: a migration that created, removed or retargeted one would
    // report nothing for it, which is the quiet under-reporting this whole
    // module exists to avoid. Hashing the link text catches all three without
    // following the link, which would risk a cycle and would double-count a
    // target that is itself under a watched path.
    if (entry.isSymbolicLink()) {
      const target = await symlinkTarget(child);
      if (target !== undefined) {
        into.set(toProjectPath(projectRoot, child), target);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const hash = await hashFile(child);
    if (hash !== undefined) {
      into.set(toProjectPath(projectRoot, child), hash);
    }
  }
}

/**
 * A marker standing in for a symlink's content: the path it points at.
 *
 * Prefixed so it cannot collide with a real sha256 hash, which is what the
 * map otherwise holds. A symlink whose target changed reads as `modified`.
 */
async function symlinkTarget(path: string): Promise<string | undefined> {
  try {
    return `symlink:${await readlink(path)}`;
  } catch {
    return undefined;
  }
}

/** Project-relative path with forward slashes, so output is platform-stable. */
function toProjectPath(projectRoot: string, absolute: string): string {
  return relative(projectRoot, absolute).split(sep).join("/");
}

/**
 * Hash every file under `paths` (each relative to `projectRoot`), which may
 * name a directory or a single file. Paths that do not exist contribute
 * nothing, which is what makes a file created by a migration read as `added`.
 */
export async function snapshotPaths(
  projectRoot: string,
  paths: string[]
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  for (const path of paths) {
    const absolute = join(projectRoot, path);
    await walk(projectRoot, absolute, snapshot);
    // A directory yields its files above; a plain file yields only itself.
    const hash = await hashFile(absolute);
    if (hash !== undefined) {
      snapshot.set(toProjectPath(projectRoot, absolute), hash);
    }
  }
  return snapshot;
}

/** Compare two {@link snapshotPaths} results. */
export function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>
): TreeChanges {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [path, hash] of after) {
    const previous = before.get(path);
    if (previous === undefined) added.push(path);
    else if (previous !== hash) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }

  return {
    added: added.toSorted(),
    modified: modified.toSorted(),
    removed: removed.toSorted(),
  };
}
