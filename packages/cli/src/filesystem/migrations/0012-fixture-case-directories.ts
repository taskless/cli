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
  valeFixtureScope,
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
 * once empty. A destination that already exists keeps its bytes, and a source
 * is removed only once every file it produced is on disk, so a rerun after a
 * partial failure finishes the job and a completed run is a no-op.
 *
 * Also refreshes the README, whose layout section names the tests directory,
 * and ignores `.sg-rules/`, the rules-only tree `check` hands ast-grep.
 */

/** Write `content` at `path` unless something is already there. */
async function writeNew(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", flag: "wx" }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  );
}

/** Write a conversion's files under `ruleDirectory`; true when there was nothing left out. */
async function apply(
  ruleDirectory: string,
  conversion: Conversion
): Promise<boolean> {
  for (const file of conversion.files) {
    await writeNew(join(ruleDirectory, file.path), file.content);
  }
  return conversion.unconverted.length === 0;
}

async function entriesOf(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
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
  for (const entry of await entriesOf(legacy)) {
    if (entry.name === ".gitkeep") continue;
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
    const conversion = convertSgTestFile(
      rule,
      entry.name,
      content,
      RULE_TESTS_DIRECTORY
    );
    notes.push(...conversion.unconverted.map((line) => `${ruleId}: ${line}`));
    if (await apply(ruleDirectory, conversion))
      await rm(source, { force: true });
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
      const conversion = convertValeDocument(
        scope,
        bucket,
        entry.name,
        await readFile(source, "utf8"),
        RULE_TESTS_DIRECTORY
      );
      notes.push(...conversion.unconverted.map((line) => `${ruleId}: ${line}`));
      if (await apply(ruleDirectory, conversion))
        await rm(source, { force: true });
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
