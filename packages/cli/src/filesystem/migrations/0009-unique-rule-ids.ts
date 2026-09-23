import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findRuleIdCollisions,
  metadataSidecarPath,
} from "../../rules/id-uniqueness";
import { listRuleIds, ruleDirectory } from "../../rules/engines";
// Safe to reach for now that the manifest lives in `filesystem/manifest.ts`.
// `reconcile-marker` reads the manifest, and while that meant importing
// `migrate.ts` — the module holding the migration registry — this import
// closed a loop that left `migrations["9"]` undefined. The manifest no longer
// knows migrations exist, so the path stops here.
import { pathExists } from "../../rules/reconcile-marker";
import {
  ENGINE_LAYOUTS,
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
 * ## An interrupted run is resumable, because the commit point is the rename
 *
 * Every edit a rule needs happens INSIDE the rule's old directory, and the
 * directory rename is the last thing to run. That ordering is the whole
 * atomicity story: `rename(2)` on a directory is a single atomic operation, so
 * it is the point at which a rule is done, and nothing before it is observable
 * as progress.
 *
 * It also makes the "is there a collision" gate a sound resume signal, which is
 * why this migration still returns early on a collision-free tree. The commit
 * is the operation that CLEARS the collision, so a rule that crashed before it
 * still collides and is picked up again; a rule that crashed after it is
 * already whole. The reverse ordering — rename the directory first, then chase
 * its contents — clears the collision before the rule is consistent, and the
 * next run's gate then reports nothing to do over a rule whose files and `id:`
 * fields still carry the old name.
 *
 * Every step inside the directory is written to tolerate having already run: a
 * file rename whose source is gone but whose target is there still has its
 * `id:` rewritten, and a fixture already carrying the target prefix is never
 * renamed a second time. File rewrites go to a temporary sibling and are
 * committed with a rename, so a crash cannot leave a half-written rule file.
 *
 * Two windows remain, and neither leaves a tree a re-run cannot repair:
 *
 * - Between the first edit and the commit the directory name disagrees with
 *   the files inside it. `verify` reports that, and the next migration run
 *   finishes it. The scaffold version is written only after every migration
 *   returns, so the next `taskless` command runs this again by itself.
 * - When a symmetric collision is interrupted between its two halves, the half
 *   that committed keeps its suffix and the half that never started keeps the
 *   bare id, because the collision it was named for is gone. The tree is
 *   collision-free and every rule is internally consistent; only the symmetry
 *   a complete run would have produced is lost.
 *
 * Durability past a power loss — between `rename(2)` returning and the
 * directory entry reaching disk — is not addressed, and no user-space rename
 * dance would address it.
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
  // Sound as a resume signal, not merely as a "nothing to do" check: the
  // directory rename that clears a collision is also the LAST thing each
  // rename does, so a rule interrupted part-way still collides and is
  // enumerated again here. See the atomicity section above.
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
    for (const id of await listRuleIds(cwd, engine)) ids.add(id);
  }
  return ids;
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

/**
 * Rename one rule and every reference to its id inside its own directory.
 *
 * THE ORDER IS THE ATOMICITY. Everything inside the rule is rewritten under the
 * OLD directory name first, and the directory rename runs last as the single
 * atomic commit. Until it lands the rule still holds the colliding id, so a
 * crash anywhere above leaves work the next run's collision scan finds.
 * Renaming the directory first would clear the collision while the files inside
 * still carried the old id, and no re-run would ever look again.
 */
async function renameRule(
  cwd: string,
  engine: EngineName,
  from: string,
  to: string
): Promise<string[]> {
  const fromPath = ruleDirectory(cwd, engine, from);
  const toPath = ruleDirectory(cwd, engine, to);

  const inside: string[] = [];
  if (engine === "sg") {
    inside.push(
      ...(await renameRuleFile(fromPath, engine, from, to)),
      ...(await renameSgFixtures(fromPath, from, to))
    );
  } else if (engine === "vale") {
    inside.push(
      ...(await renameRuleFile(fromPath, engine, from, to)),
      ...(await rewriteValeConfig(fromPath, from, to))
    );
  }
  // No `runtime` branch: this is never called for one. See `NEVER_RENAMED`.
  await rename(fromPath, toPath);
  // Reported directory-first even though it ran last: the report is read as
  // "this rule moved, and here is what moved with it".
  return [`  ${fromPath}`, `    -> ${toPath}`, ...inside];
}

/**
 * The rule file named after `from` becomes the one named after `to`, and its
 * own `id:` follows.
 *
 * The name comes from {@link ENGINE_LAYOUTS}, the table that decides it, so
 * the two engines this runs for stop being a second place that has to agree
 * with `layout.ts` about `${id}.yml`. Not `ruleFilePath`, which takes a `cwd`
 * and a rule id: this runs BEFORE the directory moves, so the path it would
 * build is the one this rule is leaving rather than the one it is in.
 *
 * Resumable both ways round. A source that is gone with the target already in
 * place is an earlier run that died between the rename and the `id:` rewrite,
 * so the rewrite is completed rather than skipped — the old early return read
 * that state as "no rule file" and left the id behind.
 */
async function renameRuleFile(
  ruleDirectoryPath: string,
  engine: EngineName,
  from: string,
  to: string
): Promise<string[]> {
  const fromName = ENGINE_LAYOUTS[engine].ruleFile(from);
  const toName = ENGINE_LAYOUTS[engine].ruleFile(to);
  const fromFile = join(ruleDirectoryPath, fromName);
  const toFile = join(ruleDirectoryPath, toName);
  if (await pathExists(fromFile)) {
    await rename(fromFile, toFile);
    const rewritten = await rewriteIdField(toFile, from, to);
    return [
      `    renamed ${fromName} -> ${toName}${rewritten ? " and its id: field" : ""}`,
    ];
  }
  if (!(await pathExists(toFile))) return [];
  return (await rewriteIdField(toFile, from, to))
    ? [`    finished an interrupted rename: ${toName} id: field`]
    : [];
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
 *
 * THE PREDICATE MUST NOT MATCH ITS OWN OUTPUT. `to` is always `<from>-…`, so a
 * plain `startsWith(`${from}-`)` accepts every name this loop produces. It cost
 * a double suffix on the FIRST run for a fixture a human had already named
 * `no-eval-sg-basic-test.yml`, which came back out as
 * `no-eval-sg-sg-basic-test.yml`; and on a resumed run it would re-suffix every
 * fixture the interrupted run had already moved. A name that already carries
 * the target prefix is therefore never renamed — it is where it belongs either
 * way — and only its `id:` follows, which is also what finishes a rename
 * interrupted between the two.
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
    if (!entry.endsWith("-test.yml")) continue;
    if (entry.startsWith(`${to}-`)) {
      if (await rewriteIdField(join(testsPath, entry), from, to)) {
        lines.push(`    rewrote ${RULE_TESTS_DIRECTORY}/${entry} id: field`);
      }
      continue;
    }
    if (!entry.startsWith(`${from}-`)) continue;
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
  await writeFileAtomically(configPath, rewritten);
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
  await writeFileAtomically(path, rewritten);
  return true;
}

/**
 * Write a file by writing a sibling and renaming it over the target, so a crash
 * mid-write cannot leave a truncated rule file or fixture.
 *
 * The temporary name is DERIVED FROM THE TARGET rather than randomized, so a
 * crash between the write and the rename leaves one predictable path that the
 * next run overwrites and consumes: the target still holds its pre-edit bytes,
 * so the next run rewrites it and reaches this same temporary again. A random
 * suffix would strand a file in the rule directory instead. The name matches
 * neither `<id>.yml` nor `*-test.yml` nor `.vale.ini`, so nothing that scans
 * the rule directory picks it up while it exists.
 */
async function writeFileAtomically(
  path: string,
  contents: string
): Promise<void> {
  const temporary = `${path}.tskl-0009.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

/** A rule id is `[a-z0-9-]+`, but escaping keeps this honest if that widens. */
function escapeForRegExp(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

export default migration;
