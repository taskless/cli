import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Migration } from "../types";

/**
 * Delete every `BasedOnStyles` assignment from each Vale rule's `.vale.ini`.
 *
 * The `create-vale-rule` recipe told every author to write `BasedOnStyles =`
 * in every matcher, and through Vale 3.21.0 the line was inert: no bundled
 * style loads unless a run-level `BasedOnStyles` names one, and the assembled
 * header names none. Vale 3.22.0 gave an empty value a meaning (upstream
 * c2d62437): it clears every setting the file inherited from an earlier
 * matcher. The assembled run config is every rule's matchers in id order, so
 * a rule writing the line under `[docs/**]` silences every alphabetically
 * earlier rule under `docs/`, and `[*.md]` beside `[*.{md,markdown}]` silences
 * the first everywhere. Only byte-identical globs, which Vale merges into one
 * section, escape. Measured on both binaries and pinned in
 * `test/vale-vendor-contract.test.ts`.
 *
 * The config schema now refuses the key (`vale-config-no-based-on-styles`),
 * so a rule still carrying it fails `verify` and refuses the Vale run at
 * `check`. This migration is what keeps an upgrade from turning every
 * existing project's `check` red: it deletes the line so the configs pass the
 * schema they passed before, with the behaviour they had before.
 *
 * A line edit, deliberately, rather than a parse and re-serialize. The
 * config schema reads the file as an AST for validation, and assembly writes
 * the author's own bytes; the parser's `toString()` is measured not to round
 * trip, so it is never called. Deleting whole lines is the one edit that
 * leaves every other byte, comment and blank line where the author put it.
 * The match is anchored on the key at the start of a line, so a comment that
 * mentions `BasedOnStyles` is left alone.
 *
 * Idempotent: a config without the line is read and not rewritten, so a
 * second run touches nothing and a project's `git status` stays clean.
 */
const migration: Migration = async (directory) => {
  const valeRules = join(directory, "rules", "vale");
  let entries;
  try {
    entries = await readdir(valeRules, { withFileTypes: true });
  } catch {
    // No Vale rules tree: nothing to rewrite. A project scaffolded before
    // `0004` and never given a Vale rule has no such directory.
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = join(valeRules, entry.name, ".vale.ini");
    let source: string;
    try {
      source = await readFile(configPath, "utf8");
    } catch {
      // A rule directory with no config declares no scope; `verify` reports
      // that, and there is nothing here to delete.
      continue;
    }
    const stripped = dropBasedOnStyles(source);
    if (stripped !== source) await writeFile(configPath, stripped, "utf8");
  }
};

/** Every `BasedOnStyles = …` assignment line, whatever its value. */
const BASED_ON_STYLES_LINE = /^[ \t]*BasedOnStyles[ \t]*=.*(?:\r?\n|$)/gm;

/** `source` with every `BasedOnStyles` assignment line removed. */
export function dropBasedOnStyles(source: string): string {
  return source.replaceAll(BASED_ON_STYLES_LINE, "");
}

export default migration;
