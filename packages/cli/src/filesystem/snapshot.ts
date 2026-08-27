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

/**
 * One entry to be resolved into a snapshot value: a file to hash, or a
 * symlink to read.
 */
interface PendingEntry {
  absolute: string;
  kind: "file" | "symlink";
}

/**
 * Collect the entries under `absolute` WITHOUT resolving them.
 *
 * Directory traversal is cheap and inherently sequential; hashing is neither.
 * Separating the two lets the hashing run with bounded concurrency below,
 * which is what keeps this usable on a tree much larger than this repository's
 * own. A snapshot runs twice per migration, so the cost is paid twice.
 */
async function walk(
  projectRoot: string,
  absolute: string,
  into: PendingEntry[]
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
      into.push({ absolute: child, kind: "symlink" });
      continue;
    }
    if (!entry.isFile()) continue;
    into.push({ absolute: child, kind: "file" });
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
/**
 * How many entries are resolved at once.
 *
 * Bounded rather than a bare `Promise.all` over the whole tree: a large
 * repository would open every file at once and hit the process descriptor
 * limit with `EMFILE`, which would surface as an unreadable file and be
 * swallowed into "not part of the snapshot". That is the quiet
 * under-reporting this module exists to avoid, so the failure mode has to be
 * designed out rather than caught.
 */
const HASH_CONCURRENCY = 32;

/** Resolve pending entries in bounded-concurrency batches. */
async function resolveEntries(
  projectRoot: string,
  pending: PendingEntry[],
  into: Map<string, string>
): Promise<void> {
  for (let start = 0; start < pending.length; start += HASH_CONCURRENCY) {
    const batch = pending.slice(start, start + HASH_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (entry) => ({
        path: toProjectPath(projectRoot, entry.absolute),
        value:
          entry.kind === "symlink"
            ? await symlinkTarget(entry.absolute)
            : await hashFile(entry.absolute),
      }))
    );
    for (const { path, value } of resolved) {
      if (value !== undefined) into.set(path, value);
    }
  }
}

export async function snapshotPaths(
  projectRoot: string,
  paths: string[]
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const pending: PendingEntry[] = [];
  for (const path of paths) {
    const absolute = join(projectRoot, path);
    await walk(projectRoot, absolute, pending);
    // A directory yields its entries above; a watched path that is itself a
    // plain file yields only itself, which is how the root `.gitignore` is
    // covered.
    pending.push({ absolute, kind: "file" });
  }
  await resolveEntries(projectRoot, pending, snapshot);
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
