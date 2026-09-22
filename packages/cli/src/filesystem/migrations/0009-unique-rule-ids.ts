import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findRuleIdCollisions,
  metadataSidecarPath,
} from "../../rules/id-uniqueness";
import { ruleDirectory } from "../../rules/engines";
// Safe to reach for now that the manifest lives in `filesystem/manifest.ts`.
// `reconcile-marker` reads the manifest, and while that meant importing
// `migrate.ts` — the module holding the migration registry — this import
// closed a loop that left `migrations["9"]` undefined. The manifest no longer
// knows migrations exist, so the path stops here.
import { pathExists } from "../../rules/reconcile-marker";
import {
  ENGINES,
  RULE_TESTS_DIRECTORY,
  type EngineName,
} from "../../rules/layout";
import { isValidRuleId } from "../../rules/validate-id";
import type { Migration } from "../types";

/**
 * Give every rule id held by more than one engine a name of its own.
 *
 * `.taskless/rules/sg/no-eval/` and `.taskless/rules/vale/no-eval/` could both
 * exist, because `isValidRuleId` is `/^[a-z0-9][a-z0-9-]*$/` with no engine
 * component and no cross-engine check. `verify` now refuses that state per
 * rule, which is the guard for a collision created after this runs — by hand,
 * or by a merge. This is what clears the ones that are already there.
 *
 * ## Why it renames rather than refuses
 *
 * A throwing migration walls `init`, and `init` is the command every other
 * refusal points at: `check` and `verify` send a stale scaffold there with
 * `SCAFFOLD_MIGRATION_REQUIRED`. Refusing therefore leaves the user in a state
 * where the CLI's own instruction is the thing that fails, and the way out is
 * a multi-file hand edit. Renaming resolves it at the one moment the CLI has
 * the user's attention and full knowledge of the layout.
 *
 * It is safe to do here because a rename reaches nothing outside the rule's
 * own directory. Measured against this tree:
 *
 * | Engine    | What carries the id                                                        |
 * | --------- | -------------------------------------------------------------------------- |
 * | `sg`      | directory, `<id>.yml`, its `id:` field, `.tests/<id>-*-test.yml` and each file's `id:` |
 * | `vale`    | directory, `<id>.yml`, and in `.vale.ini` the `tskl) rule` breadcrumb and the `<id>.<id>` assignment |
 * | `runtime` | nothing — a runtime rule is never renamed; see below |
 *
 * Both Vale segments move because `StylesPath` points at `rules/vale`, so the
 * rule directory is the style and `<id>.yml` is the check inside it. Nothing
 * outside `.taskless/rules/<engine>/<id>/` names a rule id: `taskless.json`
 * records versions rather than rules, and the runtime reconcile join is by
 * content signature, so a moved-but-unchanged rule still resolves.
 *
 * ## Runtime rules are never renamed
 *
 * A `runtime` copy keeps the bare id, and only `sg` and `vale` copies are
 * moved. Runtime rules are the tier whose artifacts are signed and blessed,
 * and leaving them untouched keeps this migration clear of that machinery
 * entirely rather than reasoning about it. Measured, a rename would in fact be
 * safe — `signRuleFile` hashes the CONTENT of `check.ts` and never its path,
 * and the reconcile join is by signature, so a moved-but-unchanged rule still
 * resolves — so this is a precaution rather than a correctness fix. It costs
 * nothing: the result is collision-free either way.
 *
 * ## Among the engines that do move, the rename is symmetric
 *
 * When `sg` and `vale` both hold an id, both move; neither keeps it. Any
 * precedence rule between them would be arbitrary, and a symmetric rename
 * means nobody has to work out which of their two rules silently kept the
 * name. `check` output moves with it, which is why the changeset says to
 * expect it.
 *
 * The result is collision-free in every case, because within one engine the
 * filesystem already guarantees one directory per id. `sg` + `runtime` leaves
 * `sg/<id>-sg` beside `runtime/<id>`; all three leaves `sg/<id>-sg`,
 * `vale/<id>-vale` and `runtime/<id>`.
 *
 * ## What it will not do
 *
 * It never clobbers. A target already in use takes the next free
 * `<id>-<engine>-2`, `-3`, … and a name is only free when NO engine holds it,
 * so clearing one collision cannot create another. It never touches
 * `.taskless/rule-metadata/<id>.yml`: the rename is symmetric, so the sidecar
 * has no natural owner and moving it to either side would be a guess. It is
 * left in place, reported, and orphaned — which costs nothing, because the
 * service does not populate the `meta` block a sidecar is written from, so
 * this CLI has never written one (`rule meta` says so when asked).
 *
 * Every rename is printed: old path, new path, and each file rewritten inside
 * it. A migration that silently renames a user's rules is worse than one that
 * refuses.
 *
 * Idempotent, and read-only when there is nothing to do. A project with no
 * collision is enumerated and nothing is written, so `git status` stays clean.
 */
/**
 * The engine whose rules keep their id whatever else holds it.
 *
 * Named rather than inlined so the carve-out is one fact in one place: the
 * loop, the docblock table and the report all mean the same thing by it.
 */
const NEVER_RENAMED: EngineName = "runtime";

const migration: Migration = async (directory) => {
  // The collision is a fact about `.taskless/rules/`, and every helper that
  // describes it takes the PROJECT root, which is this directory's parent.
  const cwd = join(directory, "..");
  const collisions = await findRuleIdCollisions(cwd);
  if (collisions.length === 0) return;

  const taken = await occupiedRuleIds(cwd);
  const lines: string[] = [];
  for (const collision of collisions) {
    for (const engine of collision.engines) {
      if (engine === NEVER_RENAMED) {
        // Said out loud rather than left as a silent omission: a reader
        // looking at a three-engine collision must not be left wondering why
        // one of the three did not move. Its id stays in `taken`, so nothing
        // else can be renamed onto it.
        lines.push(
          `  ${ruleDirectory(cwd, engine, collision.ruleId)}`,
          `    kept its id (runtime rules are never renamed)`
        );
        continue;
      }
      const to = freeRuleId(collision.ruleId, engine, taken);
      taken.add(to);
      lines.push(...(await renameRule(cwd, engine, collision.ruleId, to)));
    }
    const sidecar = metadataSidecarPath(cwd, collision.ruleId);
    if (await pathExists(sidecar)) {
      lines.push(
        `  ! ${sidecar} left in place: the rename is symmetric, so the sidecar has no owner to follow.`
      );
    }
  }
  console.error(
    [
      `Migration 9 renamed ${String(collisions.length)} rule id(s) held by more than one engine:`,
      ...lines,
    ].join("\n")
  );
};

/**
 * Every rule id in use, across every engine.
 *
 * Collected once up front rather than re-read per candidate, so a name chosen
 * for one half of a collision is unavailable to the other half in the same
 * run. Without that, `sg/x` and `vale/x` could both be offered the same free
 * name and the second rename would clobber the first.
 */
async function occupiedRuleIds(cwd: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const engine of ENGINES) {
    for (const id of await listEngineRuleIds(cwd, engine)) ids.add(id);
  }
  return ids;
}

async function listEngineRuleIds(
  cwd: string,
  engine: EngineName
): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, ".taskless", "rules", engine), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * `<id>-<engine>`, or the first free `<id>-<engine>-N` when that is taken.
 *
 * Free means held by NO engine, not merely by this one: a name that resolves
 * one collision by creating another has resolved nothing. The suffix is a
 * plain ascending integer from 2, so the choice is reproducible and a reader
 * of the printed report can see why it landed where it did.
 */
function freeRuleId(
  ruleId: string,
  engine: EngineName,
  taken: Set<string>
): string {
  const base = `${ruleId}-${engine}`;
  // `<id>` already matched `/^[a-z0-9][a-z0-9-]*$/` and every engine name is
  // lowercase letters, so the result cannot fail the id contract. Asserted
  // rather than assumed, because the one thing worse than a refusal here is a
  // rename to a name the rest of the CLI will not accept.
  if (!isValidRuleId(base)) {
    throw new Error(`Migration 9 would rename "${ruleId}" to an invalid id`);
  }
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${String(suffix)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Rename one rule and every reference to its id inside its own directory. */
async function renameRule(
  cwd: string,
  engine: EngineName,
  from: string,
  to: string
): Promise<string[]> {
  const fromPath = ruleDirectory(cwd, engine, from);
  const toPath = ruleDirectory(cwd, engine, to);
  await rename(fromPath, toPath);
  const lines = [`  ${fromPath}`, `    -> ${toPath}`];

  if (engine === "sg") {
    lines.push(
      ...(await renameRuleFile(toPath, from, to)),
      ...(await renameSgFixtures(toPath, from, to))
    );
  } else if (engine === "vale") {
    lines.push(
      ...(await renameRuleFile(toPath, from, to)),
      ...(await rewriteValeConfig(toPath, from, to))
    );
  }
  // No `runtime` branch: this is never called for one. See `NEVER_RENAMED`.
  return lines;
}

/** `<from>.yml` becomes `<to>.yml`, and its own `id:` follows. */
async function renameRuleFile(
  ruleDirectoryPath: string,
  from: string,
  to: string
): Promise<string[]> {
  const fromFile = join(ruleDirectoryPath, `${from}.yml`);
  if (!(await pathExists(fromFile))) return [];
  const toFile = join(ruleDirectoryPath, `${to}.yml`);
  await rename(fromFile, toFile);
  const rewritten = await rewriteIdField(toFile, from, to);
  return [
    `    renamed ${from}.yml -> ${to}.yml${rewritten ? " and its id: field" : ""}`,
  ];
}

/**
 * `.tests/<from>-*-test.yml` becomes `.tests/<to>-*-test.yml`, each file's
 * `id:` with it.
 *
 * BOTH halves are load-bearing, and missing either leaves a rule that looks
 * tested and is not. `discoverRuleTestFiles` claims a file for a rule by the
 * `<id>-` filename prefix, so a file left under the old prefix stops being
 * found at all and the rule fails `sg-test-file-required`. What ast-grep
 * actually RUNS is keyed on the `id:` inside the file, so a renamed file
 * still carrying the old id is discovered, silently not counted, and the rule
 * reads as having shipped no cases.
 */
async function renameSgFixtures(
  ruleDirectoryPath: string,
  from: string,
  to: string
): Promise<string[]> {
  const testsPath = join(ruleDirectoryPath, RULE_TESTS_DIRECTORY);
  let entries: string[];
  try {
    entries = await readdir(testsPath);
  } catch {
    // No fixtures. `verify` reports that as `sg-test-file-required`; it is not
    // this migration's business.
    return [];
  }
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(`${from}-`) || !entry.endsWith("-test.yml")) continue;
    const renamed = `${to}-${entry.slice(from.length + 1)}`;
    await rename(join(testsPath, entry), join(testsPath, renamed));
    const rewritten = await rewriteIdField(join(testsPath, renamed), from, to);
    lines.push(
      `    renamed ${RULE_TESTS_DIRECTORY}/${entry} -> ${RULE_TESTS_DIRECTORY}/${renamed}${rewritten ? " and its id: field" : ""}`
    );
  }
  return lines;
}

/**
 * The breadcrumb and the `<id>.<id>` assignment in a Vale rule's config.
 *
 * Both segments of the assignment move: `StylesPath` points at `rules/vale`,
 * so the rule directory is the style and `<id>.yml` is the check inside it.
 */
async function rewriteValeConfig(
  ruleDirectoryPath: string,
  from: string,
  to: string
): Promise<string[]> {
  const configPath = join(ruleDirectoryPath, ".vale.ini");
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch {
    // A rule with no config declares no scope. `verify` reports that; there is
    // nothing here to rewrite.
    return [];
  }
  const rewritten = retargetValeConfig(source, from, to);
  if (rewritten === source) return [];
  await writeFile(configPath, rewritten, "utf8");
  return [`    rewrote .vale.ini breadcrumb and ${from}.${from} assignment`];
}

/** A `.vale.ini` retargeted from one rule id to another. Exported for tests. */
export function retargetValeConfig(
  source: string,
  from: string,
  to: string
): string {
  const quoted = escapeForRegExp(from);
  return source
    .replaceAll(
      new RegExp(
        String.raw`^([ \t]*tskl\) rule[ \t]*=[ \t]*)${quoted}([ \t]*)$`,
        "gm"
      ),
      `$1${to}$2`
    )
    .replaceAll(
      new RegExp(String.raw`^([ \t]*)${quoted}\.${quoted}([ \t]*=)`, "gm"),
      `$1${to}.${to}$2`
    );
}

/**
 * Rewrite a YAML document's top-level `id:` when, and only when, it currently
 * reads as `from`.
 *
 * Anchored on the key at the start of a line, the way `0008` anchors its
 * deletion, so every other byte survives: a rule file is the author's own
 * text, and a parse-and-re-serialize would reflow it. A file whose `id:` is
 * something else is left alone rather than corrected — that is the
 * `sg-id-matches-directory` defect, `verify` already names it, and quietly
 * fixing it here would hide a rule that was never what its directory claimed.
 *
 * Returns whether anything changed, so the printed report does not claim an
 * edit it did not make.
 */
async function rewriteIdField(
  path: string,
  from: string,
  to: string
): Promise<boolean> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return false;
  }
  const rewritten = source.replaceAll(
    new RegExp(
      String.raw`^(id:[ \t]*)(['"]?)${escapeForRegExp(from)}\2([ \t]*)$`,
      "gm"
    ),
    `$1$2${to}$2$3`
  );
  if (rewritten === source) return false;
  await writeFile(path, rewritten, "utf8");
  return true;
}

/** A rule id is `[a-z0-9-]+`, but escaping keeps this honest if that widens. */
function escapeForRegExp(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

export default migration;
