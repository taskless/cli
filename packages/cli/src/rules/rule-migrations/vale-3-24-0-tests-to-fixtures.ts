import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isMap, isScalar, isSeq, parseAllDocuments } from "yaml";

import {
  deriveFixturePath,
  valeFixtureScope,
  type FixtureScope,
} from "../fixture-convert";
import { RULE_TESTS_DIRECTORY } from "../layout";
import type { RuleMigration } from "../rule-migrate";

/**
 * Move a Vale rule's `tests:` cases into `tests/pass/` and `tests/fail/`.
 *
 * Vale 3.24.0 runs the cases a rule carries under `tests:` with `vale test`.
 * Taskless never runs it: `verify` judges a Vale rule by the case directories
 * under `tests/`, and `validate` refuses the key from 3.24.0 on, so a rule written
 * against 0.12.0, which accepted it, would otherwise stop validating.
 *
 * A case is one document and whether the rule fires on it, which is exactly
 * what a fixture is. An in-rule case loads only the rule it lives in, so any
 * alert it expects is that rule's:
 *
 * | the case                       | becomes          |
 * | ------------------------------ | ---------------- |
 * | `want` with any text           | `tests/fail/`    |
 * | `want` that is empty           | `tests/pass/`    |
 * | no `want`, but `contains`      | `tests/fail/`    |
 * | only `absent`                  | `tests/pass/`    |
 *
 * What `want` pins beyond that, the exact line, column and message, is not
 * something a rule's verification needs, and it is not carried.
 *
 * Each case becomes a case directory named for the case. Its one document
 * holds the case's `input` byte for byte, takes its extension from `format`
 * (`md` when there is none, as Vale reads it), and sits at a path the rule's
 * own `.vale.ini` matchers admit, because a case is linted under those
 * matchers. Where no admitted path can be derived it sits at the case root,
 * and `verify` names the scope that excluded it. A rule with a case this cannot place is left exactly as it is:
 * one that reads its input through a `view`, which this layout never defines,
 * or that names another rule file in `rule:`. `validate` keeps refusing that
 * rule, and its message says what to do.
 *
 * The `tests:` block is removed by the parser's byte range, not by
 * re-serializing the file, so everything else in the rule stays as written.
 * An existing fixture with the same bytes counts as written, which is what
 * makes a rerun after a partial failure a no-op; one with other bytes is
 * never overwritten, and the case takes the next free name.
 *
 * The Taskless service has issued no Vale rule carrying `tests:` (confirmed
 * against its corpus, 2026-10-20), so no issued rule's signature is affected.
 */

/** One case, reduced to the two facts a fixture records. */
interface PlacedCase {
  bucket: "pass" | "fail";
  name: string;
  extension: string;
  input: string;
}

/** A rule this migration rewrites: its cases, and the block to remove. */
interface Plan {
  cases: PlacedCase[];
  blockStart: number;
  blockEnd: number;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Whether `contains` or `absent` says anything: one excerpt, or a list. */
function listed(value: unknown): boolean {
  return (
    typeof value === "string" || (Array.isArray(value) && value.length > 0)
  );
}

/** A case's bucket, or `undefined` when it asserts nothing Vale would run. */
function bucketOf(
  item: Record<string, unknown>
): PlacedCase["bucket"] | undefined {
  const want = text(item.want);
  if (want !== undefined) return want.trim() === "" ? "pass" : "fail";
  if (listed(item.contains)) return "fail";
  if (listed(item.absent)) return "pass";
  return undefined;
}

/** `flags a hedge` as `flags-a-hedge`; `case-<n>` when nothing survives. */
function slug(name: string | undefined, index: number): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return cleaned === "" ? `case-${String(index + 1)}` : cleaned;
}

/**
 * What to do with one rule file, or `undefined` to leave it alone.
 *
 * Alone means: not a single-document rule with a top-level `tests` list, or
 * one whose cases cannot all be placed. Partly migrating a rule would leave
 * it refused by `validate` with half its cases moved, which is harder to
 * finish by hand than none.
 */
export function planTestsMigration(
  source: string,
  ruleFile: string
): Plan | undefined {
  let documents;
  try {
    documents = parseAllDocuments(source);
  } catch {
    return undefined;
  }
  if (!Array.isArray(documents) || documents.length !== 1) return undefined;
  const [document] = documents;
  if (document === undefined || document.errors.length > 0) return undefined;
  const root = document.contents;
  if (!isMap(root) || !root.has("extends")) return undefined;
  const pair = root.items.find(
    (item) => isScalar(item.key) && item.key.value === "tests"
  );
  if (
    pair === undefined ||
    !isScalar(pair.key) ||
    !isSeq(pair.value) ||
    pair.key.range === undefined ||
    pair.key.range === null ||
    pair.value.range === undefined ||
    pair.value.range === null
  ) {
    return undefined;
  }

  const items: unknown = pair.value.toJSON();
  if (!Array.isArray(items)) return undefined;
  const cases: PlacedCase[] = [];
  for (const [index, raw] of items.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return undefined;
    }
    const item = raw as Record<string, unknown>;
    if (item.view !== undefined && item.view !== null) return undefined;
    const rule = text(item.rule);
    if (rule !== undefined && rule !== "" && rule !== ruleFile) {
      return undefined;
    }
    const bucket = bucketOf(item);
    if (bucket === undefined) return undefined;
    const format = text(item.format) ?? "";
    cases.push({
      bucket,
      name: slug(text(item.name), index),
      extension: format.replace(/^\./, "") || "md",
      input: text(item.input) ?? "",
    });
  }

  // From the start of the key's line through the end of the value's line.
  const keyStart = pair.key.range[0];
  const blockStart = source.lastIndexOf("\n", keyStart - 1) + 1;
  let blockEnd = pair.value.range[1];
  if (blockEnd > 0 && source[blockEnd - 1] !== "\n") {
    const newline = source.indexOf("\n", blockEnd);
    blockEnd = newline === -1 ? source.length : newline + 1;
  }
  return { cases, blockStart, blockEnd };
}

async function readExisting(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Write one case's fixture, returning its path relative to the rule
 * directory, or `undefined` when identical bytes were already there.
 */
async function writeFixture(
  ruleDirectory: string,
  placed: PlacedCase,
  scope: FixtureScope,
  taken: Set<string>
): Promise<string | undefined> {
  const bucket = join(RULE_TESTS_DIRECTORY, placed.bucket);
  for (let attempt = 1; ; attempt += 1) {
    const stem =
      attempt === 1 ? placed.name : `${placed.name}-${String(attempt)}`;
    const document =
      deriveFixturePath(scope, stem, placed.extension) ??
      `${stem}.${placed.extension}`;
    const relative = join(bucket, stem, document);
    if (taken.has(relative)) continue;
    const existing = await readExisting(join(ruleDirectory, relative));
    if (existing === placed.input) {
      taken.add(relative);
      return undefined;
    }
    if (existing !== undefined) continue;
    taken.add(relative);
    await mkdir(dirname(join(ruleDirectory, relative)), { recursive: true });
    await writeFile(join(ruleDirectory, relative), placed.input, "utf8");
    return relative;
  }
}

/** The scope the rule's own `.vale.ini` declares, or none when it has no config. */
async function ruleScope(
  directory: string,
  ruleId: string
): Promise<FixtureScope> {
  const config = await readExisting(join(directory, ".vale.ini"));
  return valeFixtureScope(ruleId, config ?? "");
}

const migration: RuleMigration = {
  engine: "vale",
  engineVersion: "3.24.0",
  summary:
    "Vale rule `tests:` cases moved into `tests/pass/` and `tests/fail/`",
  async apply(engineDirectory) {
    let ruleDirectories;
    try {
      ruleDirectories = await readdir(engineDirectory, { withFileTypes: true });
    } catch (error) {
      // No Vale rules tree: nothing to move. Anything else has to fail, not
      // read as "nothing to do": the stamp that follows would record this
      // migration as applied, and no later run would retry it.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const written: string[] = [];
    for (const ruleDirectory of ruleDirectories) {
      if (!ruleDirectory.isDirectory()) continue;
      const directory = join(engineDirectory, ruleDirectory.name);
      const files = await readdir(directory, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/\.ya?ml$/.test(file.name)) continue;
        const path = join(directory, file.name);
        const source = await readFile(path, "utf8");
        const plan = planTestsMigration(source, file.name);
        if (plan === undefined) continue;
        // Fixtures first, rule last: a failure in between leaves the cases
        // in the rule, so the rerun finds them, sees its own fixtures, and
        // only finishes the removal.
        const taken = new Set<string>();
        const scope = await ruleScope(directory, ruleDirectory.name);
        for (const placed of plan.cases) {
          const fixture = await writeFixture(directory, placed, scope, taken);
          if (fixture !== undefined) {
            written.push(join(ruleDirectory.name, fixture));
          }
        }
        await writeFile(
          path,
          source.slice(0, plan.blockStart) + source.slice(plan.blockEnd),
          "utf8"
        );
        written.push(join(ruleDirectory.name, file.name));
      }
    }
    return written;
  },
};

export default migration;
