import { copyFile, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { isMissingDirectory } from "./errno";
import type { RunDirectory } from "./run-directory";
import { engineRulesDirectory, ruleDirectory, rulesRoot } from "./engines";
import type { EngineName } from "./layout";

/**
 * The copy of `.taskless/rules/` that one `check` signs, reports, and runs.
 *
 * Copy, then sign, then run the copy. Signing the live tree and running it
 * afterwards leaves a window in which an edit runs unjudged; copying after the
 * verdict (what runtime rules used to do) leaves the same window on the other
 * side. Taking the copy first and never reading the live tree again closes both:
 * whatever the verdict describes is exactly what runs.
 *
 * It lives inside the run's own directory (see `run-directory.ts`), so
 * concurrent runs never share one and it goes when the run does.
 *
 * **The snapshot mirrors the project's layout** under a base directory:
 * `.taskless/.run/<runId>/snapshot/.taskless/rules/`. Every path helper in this package
 * takes a project root and appends `.taskless/rules/...`, and both config
 * assemblers write root-relative paths (`StylesPath`, `ruleDirs`), so handing
 * them the base instead of the project root points all of it at the snapshot
 * with no new parameter to thread through, and none to forget. Measured before
 * relying on it: identical findings from both config locations, including a
 * Vale rule scoped to a subdirectory glob.
 */

/**
 * Operating-system metadata that is neither copied nor reported.
 *
 * The service marks a rule `unsafe` when its directory holds a file it never
 * issued, and a Finder window must not fail CI. Leaving these out is safe only
 * because they are also absent from what runs: no engine reads any of them. The
 * list is closed on purpose. Growing it to "files that look harmless" would be a
 * way to hide a file from the verdict while an engine still reads it.
 */
export const IGNORED_METADATA_FILES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

/** A taken snapshot. */
export interface Snapshot {
  /** The project root the engines run from. */
  cwd: string;
  /**
   * The base that mirrors the project root: pass it wherever a function takes
   * a project root to reach the snapshot's rules and assembled configs.
   */
  base: string;
}

/**
 * Copy `.taskless/rules/` into the run's directory.
 *
 * Symbolic links are DEREFERENCED: what is signed has to be what runs, and a
 * link resolved at run time is bytes nobody signed. A link that does not
 * resolve is left out, which surfaces as a missing file in the verdict rather
 * than as a surprise when an engine follows it. A link back to a directory
 * the walk is already inside is a cycle and is not followed, so the copy
 * cannot recurse forever. Two links that merely converge on one directory are
 * NOT a cycle, and each is copied in full: skipping the second would drop a
 * rule's files from the snapshot without any verdict saying so.
 */
export async function takeSnapshot(
  cwd: string,
  run: RunDirectory
): Promise<Snapshot> {
  const base = join(run.path, "snapshot");
  await mkdir(join(base, ".taskless"), { recursive: true });

  const source = rulesRoot(cwd);
  const target = rulesRoot(base);
  try {
    await copyTree(source, target, new Set<string>());
  } catch (error) {
    if (!isMissingDirectory(error)) throw error;
    // No rules tree: an empty snapshot, which the callers read as no rules.
    await mkdir(target, { recursive: true });
  }
  return { cwd, base };
}

/**
 * `ancestors` holds the real paths of the directories on the CURRENT path from
 * the root, not every directory seen so far: only re-entering one of those is a
 * cycle. Each call extends its own copy, so siblings never see each other's.
 */
async function copyTree(
  source: string,
  target: string,
  ancestors: ReadonlySet<string>
): Promise<void> {
  const real = await realpath(source);
  if (ancestors.has(real)) return;
  const chain = new Set(ancestors).add(real);

  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_METADATA_FILES.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);

    let kind: "file" | "directory" | "other";
    if (entry.isSymbolicLink()) {
      let resolved;
      try {
        resolved = await stat(from);
      } catch (error) {
        // Dangling: nothing to sign, and nothing an engine could read.
        if (isMissingDirectory(error)) continue;
        throw error;
      }
      kind = resolved.isDirectory()
        ? "directory"
        : resolved.isFile()
          ? "file"
          : "other";
    } else {
      kind = entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other";
    }

    if (kind === "directory") await copyTree(from, to, chain);
    else if (kind === "file") await copyFile(from, to);
    // Sockets, FIFOs, devices: not rule files, and not copyable as bytes.
  }
}

/** Remove one rule from the snapshot, so no engine configuration can reach it. */
export async function excludeFromSnapshot(
  snapshot: Snapshot,
  engine: EngineName,
  ruleId: string
): Promise<void> {
  await rm(ruleDirectory(snapshot.base, engine, ruleId), {
    recursive: true,
    force: true,
  });
}

/** The snapshot's rules directory for one engine. */
export function snapshotEngineDirectory(
  snapshot: Snapshot,
  engine: EngineName
): string {
  return engineRulesDirectory(snapshot.base, engine);
}

/**
 * A path inside the snapshot, relative to the project root, for handing to an
 * engine that runs from the project root (an assembled config path is relative
 * to the base it was assembled against).
 */
export function fromProjectRoot(
  snapshot: Snapshot,
  pathInBase: string
): string {
  return relative(snapshot.cwd, join(snapshot.base, pathInBase));
}
