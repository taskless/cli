import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Migration } from "../types";
import { CLIError } from "../../util/cli-error";
import { ENGINES, RULE_TESTS_DIRECTORY, RULES_DIRECTORY } from "../../rules/engines";

/**
 * Where `0004` left each engine's rules and tests, relative to `.taskless/`.
 * This migration reads from here and writes to `rules/<engine>/<id>/`.
 */
const PRIOR_LAYOUT = {
  sg: { rules: "sg/rules", tests: "sg/rule-tests" },
  vale: { rules: "vale/rules", tests: "vale/rule-tests" },
  runtime: { rules: "runtime/rules", tests: "runtime/rule-tests" },
} as const;

/** The committed configs `0004` wrote, which assembly replaces. */
const PRIOR_CONFIGS = ["sg/sgconfig.yml", "vale/.vale.ini"] as const;

/** Files the migration adds to `.taskless/.gitignore`. */
const GENERATED_PATHS = ["/.vale.ini", "/.sgconfig.yml"] as const;

/** Directory entries, or `[]` when the directory is not there. */
async function entriesOf(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Move `source` to `destination`, creating the parent and preserving bytes.
 *
 * Content is never rewritten. Runtime capture bytes determine their
 * server-side reconciliation hashes, so a reformat here would invalidate every
 * signature — and the same guarantee is what lets this migration run against a
 * project whose rules are already blessed.
 */
async function move(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
}

/**
 * Refuse to write engine directories into a `.taskless/rules/` that still holds
 * loose rule files.
 *
 * `.taskless/rules/` is both this layout's root and the pre-`0004` flat
 * location, so the two occupy the same path. `0004` empties it by moving it to
 * `sg/rules/`; a `*.yml` still sitting there means `0004` did not complete, and
 * creating `rules/sg/` around it would interleave two layouts in one tree with
 * no way to tell them apart afterwards.
 */
async function assertRootIsFree(directory: string): Promise<void> {
  const root = join(directory, RULES_DIRECTORY);
  const stray = (await entriesOf(root))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => entry.name);
  if (stray.length === 0) return;

  throw new CLIError(
    `Cannot create the rule directories: .taskless/${RULES_DIRECTORY}/ still contains ` +
      `${stray.join(", ")} from the pre-migration layout. Migration 0004 moves those to ` +
      `.taskless/sg/rules/; run it to completion first.`,
    "SCAFFOLD_CONFLICT"
  );
}

/**
 * Move one engine's rules into per-rule directories.
 *
 * `sg` and `vale` hold a flat `<id>.yml` per rule; `runtime` already holds a
 * directory per rule, whose loose `*.yml` capture rules move down into
 * `captures/`.
 */
async function moveEngineRules(
  directory: string,
  engine: (typeof ENGINES)[number]
): Promise<void> {
  const from = join(directory, PRIOR_LAYOUT[engine].rules);

  for (const entry of await entriesOf(from)) {
    if (entry.name === ".gitkeep") continue;

    if (engine === "runtime") {
      if (!entry.isDirectory()) continue;
      const ruleDirectory = join(directory, RULES_DIRECTORY, engine, entry.name);
      await move(join(from, entry.name), ruleDirectory);

      // Capture rules move under `captures/`; `check.ts` stays at the root.
      const captures = join(ruleDirectory, "captures");
      for (const inner of await entriesOf(ruleDirectory)) {
        if (!inner.isFile()) continue;
        if (!inner.name.endsWith(".yml") && !inner.name.endsWith(".yaml")) {
          continue;
        }
        await move(
          join(ruleDirectory, inner.name),
          join(captures, inner.name)
        );
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const ruleId = entry.name.slice(0, -".yml".length);
    await move(
      join(from, entry.name),
      join(directory, RULES_DIRECTORY, engine, ruleId, entry.name)
    );
  }
}

/**
 * Move one engine's tests into each rule's `.tests/`.
 *
 * The two shapes differ and both are preserved as-is: `sg` names its tests
 * `<id>-YYYYMMDD-test.yml` in one flat directory, while `vale` keeps a
 * `<id>/` subdirectory of `pass/` and `fail/` documents.
 */
async function moveEngineTests(
  directory: string,
  engine: (typeof ENGINES)[number]
): Promise<void> {
  const from = join(directory, PRIOR_LAYOUT[engine].tests);

  for (const entry of await entriesOf(from)) {
    if (entry.name === ".gitkeep") continue;

    if (entry.isDirectory()) {
      // vale / runtime: a directory per rule.
      await move(
        join(from, entry.name),
        join(directory, RULES_DIRECTORY, engine, entry.name, RULE_TESTS_DIRECTORY)
      );
      continue;
    }

    // sg: `<id>-YYYYMMDD-test.yml`, so the id is everything before the first
    // `-` that begins the timestamp suffix.
    const match = /^(?<id>.+?)-\d{8}-test\.ya?ml$/.exec(entry.name);
    const ruleId = match?.groups?.id;
    if (ruleId === undefined) continue;
    await move(
      join(from, entry.name),
      join(
        directory,
        RULES_DIRECTORY,
        engine,
        ruleId,
        RULE_TESTS_DIRECTORY,
        entry.name
      )
    );
  }
}

/** Remove an engine's now-empty `0004` directories, leaving anything else. */
async function pruneEmpty(directory: string, relativePath: string): Promise<void> {
  const path = join(directory, relativePath);
  const remaining = (await entriesOf(path)).filter(
    (entry) => entry.name !== ".gitkeep"
  );
  if (remaining.length > 0) return;
  await rm(path, { recursive: true, force: true });
}

/**
 * Split the committed `vale/.vale.ini` into per-rule configs.
 *
 * Each matcher carrying a `tskl) rule = <id>` breadcrumb belongs to that rule.
 * A matcher **without** one cannot be attributed: it is a user's hand edit, and
 * guessing an owner or dropping it would silently change what their check
 * reports. Those are left in place and reported, so the file stays on disk with
 * only the unattributable part remaining.
 */
async function splitValeConfig(directory: string): Promise<string[]> {
  const configPath = join(directory, "vale", ".vale.ini");
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch {
    return [];
  }

  const lines = source.split("\n");
  const blocks: Array<{ ruleId?: string; lines: string[] }> = [];
  let current: { ruleId?: string; lines: string[] } | undefined;

  for (const line of lines) {
    if (line.trimStart().startsWith("[")) {
      if (current !== undefined) blocks.push(current);
      current = { lines: [line] };
      continue;
    }
    if (current === undefined) continue; // header: StylesPath / MinAlertLevel
    current.lines.push(line);
    const breadcrumb = /^\s*tskl\)\s*rule\s*=\s*(?<id>\S+)/.exec(line);
    if (breadcrumb?.groups?.id !== undefined) {
      current.ruleId = breadcrumb.groups.id;
    }
  }
  if (current !== undefined) blocks.push(current);

  const byRule = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const block of blocks) {
    const body = block.lines.join("\n").trimEnd();
    if (body === "") continue;
    if (block.ruleId === undefined) {
      orphans.push(body);
      continue;
    }
    byRule.set(block.ruleId, [...(byRule.get(block.ruleId) ?? []), body]);
  }

  for (const [ruleId, bodies] of byRule) {
    const target = join(
      directory,
      RULES_DIRECTORY,
      "vale",
      ruleId,
      ".vale.ini"
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${bodies.join("\n\n")}\n`, "utf8");
  }

  if (orphans.length === 0) {
    await rm(configPath, { force: true });
    return [];
  }

  // Keep the unattributable matchers where the user put them, and say so.
  await writeFile(configPath, `${orphans.join("\n\n")}\n`, "utf8");
  return orphans;
}

/** Append the generated config paths to `.taskless/.gitignore`. */
async function ignoreGeneratedConfigs(directory: string): Promise<void> {
  const gitignorePath = join(directory, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    // 0001 writes one; if it is missing there is nothing to preserve.
  }
  const lines = existing.split("\n");
  const present = new Set(lines.map((line) => line.trim()));
  const additions = GENERATED_PATHS.filter((path) => !present.has(path));
  if (additions.length === 0) return;
  const next = [...lines.filter((line) => line !== ""), ...additions, ""];
  await writeFile(gitignorePath, next.join("\n"), "utf8");
}

/**
 * Migration 5 — one directory per rule.
 *
 * `0004` partitioned by engine but kept rules and tests in separate trees, and
 * kept Vale's scope in one committed config every rule shared. This collapses
 * both: `.taskless/rules/<engine>/<id>/` holds the rule, its own config where
 * the engine needs one, and its tests in `.tests/`.
 *
 * The dot on `.tests/` is load-bearing — ast-grep's `ruleDirs` recurses and
 * would parse a plain `tests/` directory's YAML as rules, failing the scan.
 *
 * Content is moved, never rewritten, so runtime reconciliation signatures
 * survive. Idempotent: a tree already in the new shape has nothing to move.
 */
const migration: Migration = async (directory) => {
  await assertRootIsFree(directory);

  for (const engine of ENGINES) {
    await moveEngineRules(directory, engine);
    await moveEngineTests(directory, engine);
  }

  const orphans = await splitValeConfig(directory);

  for (const engine of ENGINES) {
    await pruneEmpty(directory, PRIOR_LAYOUT[engine].rules);
    await pruneEmpty(directory, PRIOR_LAYOUT[engine].tests);
    await pruneEmpty(directory, engine);
  }

  for (const config of PRIOR_CONFIGS) {
    if (config === "vale/.vale.ini" && orphans.length > 0) continue;
    await rm(join(directory, config), { force: true });
  }

  await ignoreGeneratedConfigs(directory);

  if (orphans.length > 0) {
    console.error(
      `Notice: .taskless/vale/.vale.ini still contains ${String(orphans.length)} ` +
        `matcher(s) with no \`tskl) rule\` breadcrumb, so they could not be ` +
        `attributed to a rule. They were left in place — move them into the ` +
        `owning rule's .vale.ini under .taskless/${RULES_DIRECTORY}/vale/.`
    );
  }
};

export default migration;
