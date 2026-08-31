import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Migration } from "../types";
import { CLIError } from "../../util/cli-error";
import {
  ENGINES,
  RULE_TESTS_DIRECTORY,
  RULES_DIRECTORY,
} from "../../rules/layout";

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
  const entries = await entriesOf(root);
  const stray = entries
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
      const ruleDirectory = join(
        directory,
        RULES_DIRECTORY,
        engine,
        entry.name
      );
      await move(join(from, entry.name), ruleDirectory);

      // Capture rules move under `captures/`; `check.ts` stays at the root.
      const captures = join(ruleDirectory, "captures");
      for (const inner of await entriesOf(ruleDirectory)) {
        if (!inner.isFile()) continue;
        if (!inner.name.endsWith(".yml") && !inner.name.endsWith(".yaml")) {
          continue;
        }
        await move(join(ruleDirectory, inner.name), join(captures, inner.name));
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
        join(
          directory,
          RULES_DIRECTORY,
          engine,
          entry.name,
          RULE_TESTS_DIRECTORY
        )
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

/** Create `path` and drop a `.gitkeep` in it when it would otherwise be empty. */
async function ensureTrackedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const entries = await entriesOf(path);
  if (entries.length === 0) {
    await writeFile(join(path, ".gitkeep"), "", "utf8");
  }
}

/**
 * Create `rules/<engine>/` for every engine, tracked when empty.
 *
 * The scaffold is what tells an author where a rule goes, and what lets engine
 * dispatch see that an engine exists at all. `0004` scaffolded its own layout
 * and this migration prunes those directories, so without this a freshly
 * migrated project would have no rules tree — every engine reporting "not
 * present" and no obvious place to write the first rule.
 */
async function scaffoldEngineDirectories(directory: string): Promise<void> {
  for (const engine of ENGINES) {
    await ensureTrackedDirectory(join(directory, RULES_DIRECTORY, engine));
  }
}

/**
 * Give every ast-grep rule a `.tests/`, tracked when it holds nothing else.
 *
 * Up to here `.tests/` only ever appeared as a side effect of moving a test
 * *into* it, so a rule that had no test at version 3 — or one whose test file
 * did not match the `<id>-YYYYMMDD-test.yml` shape `moveEngineTests` can
 * attribute — arrived at version 5 with no tests directory at all.
 *
 * **That is not a cosmetic gap.** Assembly names every rule's `.tests/` as a
 * `testConfigs` entry, and ast-grep 0.41.0 aborts the entire invocation when
 * one of them is missing (`Cannot read rule directory ...`, exit 6) — which
 * `--filter` does not scope away. One rule with no tests therefore failed
 * `taskless test` for every *other* rule in the project, with an error naming a
 * rule the author had never touched. Measured against 0.41.0: an empty
 * `.tests/`, and one holding only a `.gitkeep`, are both accepted by `sg test`
 * and `sg scan`.
 *
 * The `.gitkeep` is what makes the repair survive a commit. Git does not track
 * empty directories, so a `.tests/` created here and left empty would never
 * reach CI or a fresh clone, and the failure would come back there. It is
 * committed rather than ignored — `.taskless/.gitignore` carries only the two
 * generated configs — and never reads as a test: `verify` counts a test file
 * only when it matches `<id>-*-test.yml`, so such a rule still reports "No test
 * file found" rather than quietly passing.
 */
async function ensureSgTestDirectories(directory: string): Promise<void> {
  const engineRoot = join(directory, RULES_DIRECTORY, "sg");
  for (const entry of await entriesOf(engineRoot)) {
    if (!entry.isDirectory()) continue;
    await ensureTrackedDirectory(
      join(engineRoot, entry.name, RULE_TESTS_DIRECTORY)
    );
  }
}

/** Remove an engine's now-empty `0004` directories, leaving anything else. */
async function pruneEmpty(
  directory: string,
  relativePath: string
): Promise<void> {
  const path = join(directory, relativePath);
  const entries = await entriesOf(path);
  const remaining = entries.filter((entry) => entry.name !== ".gitkeep");
  if (remaining.length > 0) return;
  await rm(path, { recursive: true, force: true });
}

/**
 * Rewrite a matcher's assignments from the old check name to the new one.
 *
 * **This is the difference between a migrated rule that runs and one that is
 * silently disabled.** A Vale check is named `<style>.<rule>`, and the style is
 * whatever directory `StylesPath` points at. Under the old flat layout
 * (`StylesPath = .`, rules loose in `vale/rules/`) the style was `rules`, so
 * assignments read `rules.<id> = YES`. This layout makes each rule directory
 * its own style, so the same rule is now `<id>.<id>`.
 *
 * Carrying the old name across would leave a config Vale parses happily,
 * reports nothing for, and exits zero on — the rule verified, the check ran,
 * and no finding ever appeared. Found by migrating a real project and noticing
 * the Vale rule stopped firing while ast-grep kept working.
 */
function retargetCheckName(lines: string[], ruleId: string): string[] {
  const escaped = ruleId.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  const assignment = new RegExp(
    String.raw`^(\s*)rules\.` + escaped + String.raw`(\s*=)`
  );
  return lines.map((line) =>
    line.replace(assignment, `$1${ruleId}.${ruleId}$2`)
  );
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
    if (block.ruleId === undefined) {
      const body = block.lines.join("\n").trimEnd();
      if (body !== "") orphans.push(body);
      continue;
    }
    const body = retargetCheckName(block.lines, block.ruleId)
      .join("\n")
      .trimEnd();
    if (body === "") continue;
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
 *
 * **Assumption: `0004` and `0005` ship in the same release.** The Vale split
 * attributes a matcher only by its `tskl) rule = <id>` breadcrumb, which is
 * something `0004` wrote — a hand-written `0004`-era `.vale.ini` would carry
 * no breadcrumb and be reported as an orphan rather than split. That is
 * accepted rather than guarded, because `0004` is unreleased: no published
 * install can be sitting at version 4 with a config a person wrote by hand,
 * so the case the fallback would serve does not exist. Should `0004` ever
 * reach a release ahead of `0005`, this assumption expires and attribution
 * needs a breadcrumb-free path.
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

  await ensureSgTestDirectories(directory);
  await scaffoldEngineDirectories(directory);
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
