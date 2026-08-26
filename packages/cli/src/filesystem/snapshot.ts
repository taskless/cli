import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
    if (!entry.isFile()) continue;
    const hash = await hashFile(child);
    if (hash !== undefined) {
      into.set(toProjectPath(projectRoot, child), hash);
    }
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
