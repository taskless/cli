import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Migration } from "../types";
import { CLIError } from "../../util/cli-error";

/**
 * Default `sgconfig.yml` written when a project has none to move. `ruleDirs`
 * and `testDir` are relative to the config file, so this is the same content
 * the pre-migration ephemeral generator produced — it simply now lives beside
 * the rules it points at, inside `sg/`.
 */
const SG_CONFIG_CONTENT = `ruleDirs:\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n`;

/**
 * The scaffolded `.vale.ini`.
 *
 * `StylesPath` is the engine directory, NOT `rules/`. Vale treats StylesPath as
 * a directory *of styles*, so a rule at `vale/rules/no-simply.yml` is the
 * `no-simply` rule of the `rules` style, and its check is `rules.no-simply` —
 * which is the name `stripRulesPrefix` in `vale/map.ts` exists to undo, and the
 * shape `verify.ts` generates. Pointing StylesPath at `rules/` instead makes
 * that same file a style directory with no rules in it: every check resolves to
 * nothing, Vale reports `{}`, and a prose check passes clean with every rule
 * silently disabled. Measured against the real binary, which is the only way
 * this is visible — the layout is identical either way.
 */
const VALE_CONFIG_CONTENT = `StylesPath = .\nMinAlertLevel = suggestion\n\n[*]\n`;

/** Directories that must exist after the migration, tracked when empty. */
const SCAFFOLD_DIRECTORIES = [
  ["sg", "rules"],
  ["sg", "rule-tests"],
  ["vale", "rules"],
  ["vale", "rule-tests"],
  ["runtime", "rules"],
  ["runtime", "rule-tests"],
] as const;

/**
 * Every path that must be a directory for the migration to complete: each
 * scaffold directory *and* each of its ancestors, shallow first.
 *
 * The engine roots (`sg/`, `vale/`, `runtime/`) are only ever created
 * implicitly, as a side effect of creating the directories under them, so they
 * appear in no other list — and a file sitting at one of those roots blocks the
 * migration just as surely as a file at a leaf.
 */
const REQUIRED_DIRECTORIES: string[][] = (() => {
  const seen = new Set<string>();
  const paths: string[][] = [];
  for (const segments of SCAFFOLD_DIRECTORIES) {
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth);
      const key = prefix.join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push([...prefix]);
    }
  }
  return paths;
})();

/**
 * Trees moved by this migration, as [legacy path, engine-partitioned path]
 * relative to `.taskless/`. Every move is content-preserving: runtime capture
 * bytes determine their server-side reconciliation hashes, so a rewrite here
 * would invalidate every signature.
 */
const MOVES: Array<[string[], string[]]> = [
  [["rules"], ["sg", "rules"]],
  [["rule-tests"], ["sg", "rule-tests"]],
  [["sgconfig.yml"], ["sg", "sgconfig.yml"]],
  [["runtime-rules"], ["runtime", "rules"]],
  [["runtime-rule-tests"], ["runtime", "rule-tests"]],
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move `source` to `destination`, preserving contents exactly.
 *
 * When `destination` does not exist this is a plain rename (a copy+delete
 * fallback covers a cross-device `.taskless/`). When it does exist — a
 * half-applied earlier run, or a project that already started using the new
 * layout — directory contents are merged entry by entry with the destination
 * winning, and any source entry that could not be merged is left in place
 * rather than deleted. The legacy path stays readable, so leftovers keep
 * running instead of disappearing.
 */
async function movePreservingContent(
  source: string,
  destination: string
): Promise<void> {
  if (!(await pathExists(source))) return;

  await mkdir(dirname(destination), { recursive: true });

  if (!(await pathExists(destination))) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    }
    await cp(source, destination, {
      recursive: true,
      preserveTimestamps: true,
    });
    await rm(source, { recursive: true, force: true });
    return;
  }

  const [sourceStats, destinationStats] = await Promise.all([
    stat(source),
    stat(destination),
  ]);
  if (!sourceStats.isDirectory() || !destinationStats.isDirectory()) {
    // Something already occupies the destination and at least one side is a
    // file, so there is no merge to perform. Checking only the source would
    // let a directory recurse into a file destination and fail with ENOTDIR
    // part-way through the migration, having already moved some entries.
    return;
  }

  for (const entry of await readdir(source)) {
    await movePreservingContent(join(source, entry), join(destination, entry));
  }

  // Remove the legacy directory only when nothing was left behind.
  try {
    await rmdir(source);
  } catch {
    // Not empty (collisions kept at the source) — leave it for the user.
  }
}

/** Write `content` to `path` only when nothing is there yet. */
async function writeIfAbsent(path: string, content: string): Promise<void> {
  if (await pathExists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/**
 * Anchor the legacy `sgconfig.yml` entry in `.taskless/.gitignore` to the
 * directory root.
 *
 * Migration `0001` wrote the pattern unanchored, when the only `sgconfig.yml`
 * was the ephemeral one generated directly in `.taskless/`. A gitignore pattern
 * without a slash matches at **any** depth, so that same line would now also
 * ignore the committed `.taskless/sg/sgconfig.yml` this layout makes the source
 * of truth — the config would silently never be tracked. `/sgconfig.yml` still
 * ignores the ephemeral file and nothing below it.
 */
async function anchorSgConfigIgnore(directory: string): Promise<void> {
  const gitignorePath = join(directory, ".gitignore");
  let existing: string;
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    return; // No .gitignore — 0001 writes one, nothing to fix.
  }

  let changed = false;
  let seenAnchored = false;
  const rewritten: string[] = [];
  for (const line of existing.split("\n")) {
    const anchored =
      line.trim() === "sgconfig.yml" ? "/sgconfig.yml" : line.trim();
    if (anchored === "/sgconfig.yml") {
      // 0001 may already have appended the anchored form beside the legacy
      // unanchored one; collapse them into a single entry.
      if (seenAnchored) {
        changed = true;
        continue;
      }
      seenAnchored = true;
      if (line.trim() !== "/sgconfig.yml") changed = true;
      rewritten.push("/sgconfig.yml");
      continue;
    }
    rewritten.push(line);
  }
  if (!changed) return;
  await writeFile(gitignorePath, rewritten.join("\n"), "utf8");
}

/**
 * Refuse to start when a **file** sits where an engine directory belongs.
 *
 * Checked up front, before anything moves. Every one of these paths must end up
 * a directory, and none of the steps below can merge a file into one: the move
 * declines, then `mkdir` fails with a bare `EEXIST` — after earlier moves have
 * already happened. Failing first keeps `.taskless/` in the state the user can
 * still reason about, and says which path to deal with.
 */
async function assertNoDirectoryConflicts(directory: string): Promise<void> {
  const conflicts: string[] = [];
  for (const segments of REQUIRED_DIRECTORIES) {
    const path = join(directory, ...segments);
    // `stat` throws ENOTDIR — not ENOENT — when an ancestor is a file, and
    // treating that as "nothing there" is what let an occupied engine root
    // through. Ancestors are checked before their children, so the root is
    // reported and the children below it are skipped as unreachable rather
    // than each producing a confusing second complaint.
    let stats;
    try {
      stats = await stat(path);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) conflicts.push(segments.join("/"));
  }
  if (conflicts.length === 0) return;

  throw new CLIError(
    `Cannot partition .taskless/ by engine: ${conflicts
      .map((path) => `.taskless/${path}`)
      .join(
        ", "
      )} ${conflicts.length === 1 ? "is a file" : "are files"}, but ` +
      `must be a directory. Move or delete it, then run the command again.`,
    "SCAFFOLD_CONFLICT"
  );
}

/** Create `path` and drop a `.gitkeep` in it when it would otherwise be empty. */
async function ensureTrackedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length === 0) {
    await writeFile(join(path, ".gitkeep"), "", "utf8");
  }
}

/**
 * Migration 4 — partition rules into per-engine directories.
 *
 * `rules/`, `rule-tests/`, and `sgconfig.yml` move under `sg/`; the runtime
 * tier moves to `runtime/rules/` and `runtime/rule-tests/`; `vale/` is
 * scaffolded with its native config but stays inert (no engine reads it yet).
 *
 * The move edits no file contents. `sgconfig.yml`'s `ruleDirs: [rules]` is
 * relative to the config file, so it stays valid after the move with no path
 * rewriting, and runtime capture hashes are unchanged.
 *
 * Idempotent: re-running against an already-migrated `.taskless/` is a no-op
 * beyond re-asserting the scaffold.
 */
const migration: Migration = async (directory) => {
  await assertNoDirectoryConflicts(directory);

  for (const [from, to] of MOVES) {
    await movePreservingContent(
      join(directory, ...from),
      join(directory, ...to)
    );
  }

  await writeIfAbsent(join(directory, "sg", "sgconfig.yml"), SG_CONFIG_CONTENT);
  await writeIfAbsent(
    join(directory, "vale", ".vale.ini"),
    VALE_CONFIG_CONTENT
  );

  for (const segments of SCAFFOLD_DIRECTORIES) {
    await ensureTrackedDirectory(join(directory, ...segments));
  }

  await anchorSgConfigIgnore(directory);
};

export default migration;
