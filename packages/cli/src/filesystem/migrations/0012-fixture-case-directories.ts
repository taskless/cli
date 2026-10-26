import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseDocument } from "yaml";

import { addToGitignore } from "../gitignore";
import { buildReadmeContent } from "./0001-init";
import { readmeSpecifier } from "../../util/package-manager";
import { pathExists } from "../../rules/reconcile-marker";
import {
  convertSgTestFile,
  convertValeDocument,
  claimedCasesOf,
  valeFixtureScope,
  type ClaimedCases,
  type Conversion,
} from "../../rules/fixture-convert";
import {
  ENGINE_LAYOUTS,
  ENGINES,
  LEGACY_RULE_TESTS_DIRECTORY,
  RULE_TESTS_DIRECTORY,
  RULES_DIRECTORY,
  type EngineName,
} from "../../rules/layout";
import type { FixtureBucket } from "../../rules/fixtures";
import type { Migration } from "../types";

/**
 * Move every rule's fixtures from `.tests/` into `tests/pass/<case>/` and
 * `tests/fail/<case>/`.
 *
 * A layout is what the scaffold version records, so this is a scaffold
 * migration rather than a rule-content one. Fixtures carry no signature, so
 * moving or rewriting them changes no signed byte: it is as safe for an issued
 * rule as for a hand-written one.
 *
 * | Engine    | From                                       | To                                     |
 * | --------- | ------------------------------------------ | -------------------------------------- |
 * | `sg`      | each `valid:`/`invalid:` snippet of `.tests/*.yml` | one case per snippet           |
 * | `vale`    | `.tests/<bucket>/<name>`                   | `tests/<bucket>/<stem>/<path>`         |
 * | `runtime` | `.tests/<bucket>/<case>/…`                 | `tests/<bucket>/<case>/…`, unchanged   |
 *
 * The conversion itself is `rules/fixture-convert.ts`, shared with delivery.
 * Each converted file sits at a path the rule's scope admits, because a case
 * is now judged by the engine's own check with the case as its root.
 *
 * **Never deletes what it did not convert.** A test file that does not parse,
 * a language with no extension, a scope no path can be derived for, an ast-grep
 * test file whose `id:` names another rule (it never ran for this one): each
 * is left under `.tests/` and named in one notice. `.tests/` is removed only
 * once empty. A source is removed only once every file it produced is on disk.
 * A destination already holding the same bytes counts as on disk, so a rerun
 * after a partial failure finishes the job and a completed run is a no-op; one
 * holding other bytes keeps them, and the source stays and is named.
 *
 * Case names are claimed across all of a rule's legacy files, read in name
 * order, so a rule's second dated test file continues at `fail-02` rather than
 * landing on the first file's `fail-01`, and past every case already in
 * `tests/`, so a file converted on a later run (after its author fixed it)
 * lands beside the cases an earlier run wrote. A source whose conversion is
 * already on disk byte for byte, from a run interrupted before it removed the
 * source, is recognised first and only removed.
 *
 * ast-grep's `__snapshots__/` under `.tests/` is removed: it records the
 * output of `sg test`, which nothing runs any more, and is not a fixture.
 *
 * Also refreshes the README, whose layout section names the tests directory,
 * and ignores `.sg-rules/`, the rules-only tree `check` hands ast-grep.
 */

/**
 * Write `content` at `path` unless something is already there. True when
 * `path` now holds `content`, false when it already held something else.
 */
async function writeNew(path: string, content: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(path, "utf8")) === content;
  }
}

/**
 * Write a conversion's files under `ruleDirectory`. True when its source can
 * go: nothing was left out and every file it produced is on disk.
 */
async function apply(
  ruleDirectory: string,
  ruleId: string,
  conversion: Conversion,
  notes: string[]
): Promise<boolean> {
  notes.push(...conversion.unconverted.map((line) => `${ruleId}: ${line}`));
  let complete = conversion.unconverted.length === 0;
  for (const file of conversion.files) {
    if (!(await writeNew(join(ruleDirectory, file.path), file.content))) {
      notes.push(`${ruleId}: ${file.path} already exists with other content`);
      complete = false;
    }
  }
  return complete;
}

/** Whether every file `conversion` produced is on disk with exactly its bytes. */
async function alreadyOnDisk(
  ruleDirectory: string,
  conversion: Conversion
): Promise<boolean> {
  if (conversion.unconverted.length > 0 || conversion.files.length === 0)
    return false;
  for (const file of conversion.files) {
    let existing: string;
    try {
      existing = await readFile(join(ruleDirectory, file.path), "utf8");
    } catch {
      return false;
    }
    if (existing !== file.content) return false;
  }
  return true;
}

/**
 * Convert one source and write it. True when the source can go.
 *
 * `ran` holds the cases this run has claimed, `onDisk` the ones `tests/` held
 * when it started. Asked first without `onDisk`: if that conversion is on disk
 * already, an interrupted run wrote it and only the source is left to remove.
 * Otherwise every existing case is claimed, so nothing lands on one.
 */
async function convertOne(
  ruleDirectory: string,
  ruleId: string,
  notes: string[],
  onDisk: ClaimedCases,
  ran: ClaimedCases,
  convert: (claimed: ClaimedCases) => Conversion
): Promise<boolean> {
  const resumed = new Set(ran);
  if (await alreadyOnDisk(ruleDirectory, convert(resumed))) {
    for (const entry of resumed) ran.add(entry);
    return true;
  }
  const claimed = new Set([...onDisk, ...ran]);
  const conversion = convert(claimed);
  for (const entry of claimed) ran.add(entry);
  return apply(ruleDirectory, ruleId, conversion, notes);
}

/** The cases `tests/` holds in a rule directory, as `<bucket>/<case>`. */
async function casesOnDisk(ruleDirectory: string): Promise<ClaimedCases> {
  const paths: string[] = [];
  for (const bucket of BUCKETS) {
    for (const entry of await entriesOf(
      join(ruleDirectory, RULE_TESTS_DIRECTORY, bucket)
    )) {
      paths.push(`${RULE_TESTS_DIRECTORY}/${bucket}/${entry.name}/`);
    }
  }
  return claimedCasesOf(paths, RULE_TESTS_DIRECTORY);
}

/** `path`'s entries in name order, so case ordinals do not depend on the filesystem. */
async function entriesOf(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
  } catch {
    return [];
  }
}

/** Remove `path` and its now-empty buckets if nothing but `.gitkeep` is left. */
async function pruneIfEmpty(path: string): Promise<void> {
  for (const entry of await entriesOf(path)) {
    if (entry.isDirectory()) await pruneIfEmpty(join(path, entry.name));
  }
  const left = await entriesOf(path);
  if (left.every((entry) => entry.name === ".gitkeep")) {
    await rm(path, { recursive: true, force: true });
  }
}

const BUCKETS: readonly FixtureBucket[] = ["pass", "fail"];

async function migrateSg(
  ruleDirectory: string,
  ruleId: string,
  legacy: string,
  notes: string[]
): Promise<void> {
  const ruleFile = join(ruleDirectory, ENGINE_LAYOUTS.sg.ruleFile(ruleId));
  let rule: string;
  try {
    rule = await readFile(ruleFile, "utf8");
  } catch {
    notes.push(
      `${ruleId}: no ${ENGINE_LAYOUTS.sg.ruleFile(ruleId)} to read a language from`
    );
    return;
  }
  const onDisk = await casesOnDisk(ruleDirectory);
  const ran: ClaimedCases = new Set();
  for (const entry of await entriesOf(legacy)) {
    if (entry.name === ".gitkeep") continue;
    if (entry.name === "__snapshots__" && entry.isDirectory()) {
      await rm(join(legacy, entry.name), { recursive: true, force: true });
      continue;
    }
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) {
      notes.push(`${ruleId}: ${entry.name} is not an ast-grep test file`);
      continue;
    }
    const source = join(legacy, entry.name);
    const content = await readFile(source, "utf8");
    let declared: unknown;
    try {
      declared = (parseDocument(content).toJS() as { id?: unknown } | null)?.id;
    } catch {
      declared = undefined;
    }
    if (
      declared !== undefined &&
      JSON.stringify(declared) !== JSON.stringify(ruleId)
    ) {
      notes.push(
        `${ruleId}: ${entry.name} declares id ${JSON.stringify(declared)}, so it never ran for this rule`
      );
      continue;
    }
    const converted = await convertOne(
      ruleDirectory,
      ruleId,
      notes,
      onDisk,
      ran,
      (claimed) =>
        convertSgTestFile(
          rule,
          entry.name,
          content,
          RULE_TESTS_DIRECTORY,
          claimed
        )
    );
    if (converted) await rm(source, { force: true });
  }
}

async function migrateVale(
  ruleDirectory: string,
  ruleId: string,
  legacy: string,
  notes: string[]
): Promise<void> {
  const configFile = ENGINE_LAYOUTS.vale.ruleConfigFile;
  let config = "";
  if (configFile !== undefined) {
    try {
      config = await readFile(join(ruleDirectory, configFile), "utf8");
    } catch {
      // No config means no enabling matcher, so nothing is admitted and every
      // document is named below as unconverted.
    }
  }
  const scope = valeFixtureScope(ruleId, config);
  const onDisk = await casesOnDisk(ruleDirectory);
  const ran: ClaimedCases = new Set();
  for (const bucket of BUCKETS) {
    for (const entry of await entriesOf(join(legacy, bucket))) {
      if (entry.name === ".gitkeep") continue;
      if (!entry.isFile()) {
        notes.push(
          `${ruleId}: ${bucket}/${entry.name} is not a fixture document`
        );
        continue;
      }
      const source = join(legacy, bucket, entry.name);
      const content = await readFile(source, "utf8");
      const converted = await convertOne(
        ruleDirectory,
        ruleId,
        notes,
        onDisk,
        ran,
        (claimed) =>
          convertValeDocument(
            scope,
            bucket,
            entry.name,
            content,
            RULE_TESTS_DIRECTORY,
            claimed
          )
      );
      if (converted) await rm(source, { force: true });
    }
  }
}

async function migrateRuntime(
  ruleDirectory: string,
  ruleId: string,
  legacy: string,
  notes: string[]
): Promise<void> {
  for (const bucket of BUCKETS) {
    for (const entry of await entriesOf(join(legacy, bucket))) {
      if (entry.name === ".gitkeep") continue;
      if (!entry.isDirectory()) {
        notes.push(
          `${ruleId}: ${bucket}/${entry.name} is not a case directory`
        );
        continue;
      }
      const destination = join(
        ruleDirectory,
        RULE_TESTS_DIRECTORY,
        bucket,
        entry.name
      );
      if (await pathExists(destination)) {
        notes.push(
          `${ruleId}: ${RULE_TESTS_DIRECTORY}/${bucket}/${entry.name} already exists`
        );
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(legacy, bucket, entry.name), destination);
    }
  }
}

const MIGRATE: Record<
  EngineName,
  (
    ruleDirectory: string,
    ruleId: string,
    legacy: string,
    notes: string[]
  ) => Promise<void>
> = { sg: migrateSg, vale: migrateVale, runtime: migrateRuntime };

const migration: Migration = async (directory) => {
  const notes: string[] = [];
  for (const engine of ENGINES) {
    const engineRoot = join(directory, RULES_DIRECTORY, engine);
    for (const entry of await entriesOf(engineRoot)) {
      if (!entry.isDirectory()) continue;
      const ruleDirectory = join(engineRoot, entry.name);
      const legacy = join(ruleDirectory, LEGACY_RULE_TESTS_DIRECTORY);
      if (!(await pathExists(legacy))) continue;
      await MIGRATE[engine](ruleDirectory, entry.name, legacy, notes);
      await pruneIfEmpty(legacy);
    }
  }

  await writeFile(
    join(directory, "README.md"),
    buildReadmeContent(readmeSpecifier()),
    "utf8"
  );
  // `addToGitignore` takes the project root and appends `.taskless` itself.
  await addToGitignore(dirname(directory), ["/.sg-rules/"]);

  if (notes.length > 0) {
    console.error(
      [
        `Migration 12 left ${String(notes.length)} fixture(s) under ${LEGACY_RULE_TESTS_DIRECTORY}/, unconverted:`,
        ...notes.map((note) => `  ${note}`),
      ].join("\n")
    );
  }
};

export default migration;
