import {
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Migration } from "../types";

/**
 * Default `sgconfig.yml` written when a project has none to move. `ruleDirs`
 * and `testDir` are relative to the config file, so this is the same content
 * the pre-migration ephemeral generator produced — it simply now lives beside
 * the rules it points at, inside `sg/`.
 */
const SG_CONFIG_CONTENT = `ruleDirs:\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n`;

/**
 * Minimal, inert `.vale.ini`. Nothing executes Vale yet; this exists so the
 * engine directory has its native config in the canonical place from day one.
 */
const VALE_CONFIG_CONTENT = `StylesPath = rules\nMinAlertLevel = suggestion\n\n[*]\n`;

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

  const sourceStats = await stat(source);
  if (!sourceStats.isDirectory()) {
    // A file already exists at the destination — leave both alone.
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
};

export default migration;
