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
import { isKnownEngine } from "../../rules/engines";

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
 * `StylesPath` is the engine directory, NOT `rules/` — **for this layout**.
 * Vale treats StylesPath as a directory *of styles*, so with rules flat in
 * `vale/rules/`, `rules` is the style and a rule at `vale/rules/no-simply.yml`
 * is the check `rules.no-simply`. Pointing StylesPath at `rules/` instead makes
 * that same file a style directory with no rules in it: every check resolves to
 * nothing, Vale reports `{}`, and a prose check passes clean with every rule
 * silently disabled.
 *
 * **Do not carry that conclusion forward.** Migration `0005` moves each rule
 * into its own directory, and there `StylesPath = rules/vale` is the *correct*
 * setting and `.` is the one that resolves nothing — the exact reverse.
 * StylesPath is a function of the layout, and the same value is right for one
 * and silently wrong for the other. Both measured against the real binary,
 * which is the only way either is visible: the files look identical.
 *
 * It carries **no section**, so a scaffolded project lints nothing until an
 * author scopes something deliberately. An unscoped `[*]` would apply every
 * enabled rule to every file the walk reaches, making the default the widest
 * scope available rather than the narrowest — and scope is the author's
 * decision to make. `create-vale-rule` teaches writing the first section; the
 * mistake that invites (a `rules.<id> = YES` above the first `[…]` line, which
 * Vale ignores with a `W101` on stderr and exit 0) is why `runVale` surfaces a
 * zero-exit stderr as a notice. The two ship together: without the notice, this
 * scaffold would trade a too-wide default for a silent one.
 */
const VALE_CONFIG_CONTENT = `StylesPath = .\nMinAlertLevel = suggestion\n`;

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

/**
 * Is `.taskless/rules/` already partitioned by engine — i.e. newer than this
 * migration rather than older?
 *
 * `rules/` is the one path in `MOVES` that means two different things. It is
 * the pre-`0004` flat location (`rules/<id>.yml`) *and* the root of the layout
 * `0005` establishes (`rules/<engine>/<id>/`), so the same move that upgrades
 * an old tree wrecks a current one.
 *
 * That collision is reachable, because a `.taskless/` with no `taskless.json`
 * reads as version 0 and runs **every** migration — a project whose manifest
 * was never committed, or was deleted, arrives here in the 0005 shape. Moving
 * `rules/` then produces `.taskless/sg/rules/sg/<id>/<id>.yml`; `0005`
 * afterwards scaffolds fresh empty engine directories over the hole, and
 * `check` scans a tree with no rules in it and exits 0 on a clean report. The
 * failure is not an error the user can see — it is a project that quietly
 * stopped being checked.
 *
 * The two shapes are distinguishable by what they hold: pre-`0004` holds loose
 * rule *files* (`rules/<id>.yml`), the current layout holds engine
 * *directories*. Recognition keys on exactly those two signals — at least one
 * directory named for an engine, and no loose `*.yml` at the root — which is
 * the same signal `0005`'s `assertRootIsFree` reads from the other side.
 *
 * Deliberately not "every entry is an engine directory": a single unrelated
 * entry beside the real ones is ordinary (macOS writes `.DS_Store` the moment
 * a folder is opened in Finder, `.gitignore` notwithstanding), and under a
 * strict rule it would flip the guard off and move a live `rules/` tree
 * wholesale — reproducing the exact bug this guard exists to prevent. A tree
 * that still holds pre-`0004` rule files is genuinely mixed, and that one does
 * migrate, because leaving it alone would strand rules the old layout owns.
 */
async function rulesArePartitionedByEngine(root: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    // No `rules/` at all — nothing to protect. Anything else (a permission
    // problem, an I/O error) is unhealthy filesystem state, and this migration
    // moves directories on the strength of what it reads here: swallowing it
    // would relocate a tree whose contents were never actually inspected.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
  if (
    !entries.some((entry) => entry.isDirectory() && isKnownEngine(entry.name))
  )
    return false;
  return !entries.some(
    (entry) => entry.isFile() && entry.name.endsWith(".yml")
  );
}

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
 * scaffolded with its native config, which `check` reads and runs alongside
 * ast-grep. The scaffold enables no rules, so it is quiet until a user adds
 * one — quiet, not inert, and the difference is why `VALE_CONFIG_CONTENT`
 * above has to be a config Vale can actually resolve rules under.
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

  // Only `rules/` needs this check. The other four sources — `rule-tests/`,
  // `sgconfig.yml`, `runtime-rules/`, `runtime-rule-tests/` — are names no
  // later layout uses, so on a current tree they simply do not exist and their
  // moves are already no-ops.
  const skipRulesMove = await rulesArePartitionedByEngine(
    join(directory, "rules")
  );

  for (const [from, to] of MOVES) {
    if (skipRulesMove && from.length === 1 && from[0] === "rules") continue;
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
