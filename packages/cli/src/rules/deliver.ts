import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { GeneratedRule } from "../api/rules";
import {
  ENGINE_LAYOUTS,
  RULE_TESTS_DIRECTORY,
  type EngineName,
} from "./layout";
import { ruleDirectory } from "./engines";
import { isMissingDirectory } from "./errno";

/**
 * One file of a delivered rule, its path relative to the rule directory.
 *
 * NOT YET IN THE GENERATED SCHEMA. `GeneratedRule` is derived from
 * `src/generated/api.d.ts`, which is generated from the service's own OpenAPI
 * document, and the file-set tier is not live there yet. This shape is the
 * agreed contract read structurally in the meantime; when the tier ships, the
 * schema is regenerated and this narrows to a field access.
 */
export interface DeliveredFile {
  /** Path relative to `.taskless/rules/<engine>/<id>/`. */
  path: string;
  /** The file's text, written verbatim. */
  content: string;
}

/**
 * What a delivered rule says about a file set: nothing, something malformed,
 * or a usable one.
 *
 * THREE OUTCOMES, NOT TWO. Folding "malformed" into "absent" would send the
 * payload down the legacy `content` path, where a rule carrying `files` has no
 * `content` to serialize and the rule file is written from `undefined`.
 * Folding it into "an empty set" is what this used to do, and it reported
 * `delivered no files` for a payload that delivered several — sending whoever
 * is debugging a real shape defect to look in the wrong place.
 */
export type DeliveredFileSet =
  | { kind: "absent" }
  | { kind: "malformed"; reason: string }
  | { kind: "present"; files: DeliveredFile[] };

/** Read a delivered rule's file set. */
export function deliveredFiles(rule: GeneratedRule): DeliveredFileSet {
  const candidate = (rule as { files?: unknown }).files;
  if (candidate === undefined) return { kind: "absent" };
  if (!Array.isArray(candidate)) {
    return {
      kind: "malformed",
      reason: "carries a `files` that is not an array",
    };
  }
  const files: DeliveredFile[] = [];
  for (const [index, entry] of candidate.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return {
        kind: "malformed",
        reason: `carries a \`files[${index}]\` that is not an object`,
      };
    }
    const file = entry as Partial<DeliveredFile>;
    // Named individually so the error points at the field, not the entry.
    if (typeof file.path !== "string") {
      return {
        kind: "malformed",
        reason: `carries a \`files[${index}]\` with no string \`path\``,
      };
    }
    if (typeof file.content !== "string") {
      return {
        kind: "malformed",
        reason: `carries \`${file.path}\` with no string \`content\``,
      };
    }
    files.push({ path: file.path, content: file.content });
  }
  return { kind: "present", files };
}

/**
 * Why a delivered path may not be written, or `undefined` when it may.
 *
 * A NEW ATTACK SURFACE, and worth naming as one. While the response carried a
 * single structured object the client computed its own destination, so no path
 * ever crossed the wire. A file set means the service names locations on a
 * developer's disk, and the difference between `captures/x.yml` and
 * `../../../../.ssh/authorized_keys` is one string.
 *
 * Checked by shape AND by resolution: the shape rules are the readable
 * statement of intent, and the containment check is what actually holds if a
 * shape rule is ever wrong. Note `path.resolve` collapses `..` itself, so the
 * containment check alone would pass a path the shape rules reject — they are
 * not redundant, they fail in different directions.
 */
export function describeUnsafePath(
  ruleDirectoryPath: string,
  path: string
): string | undefined {
  if (path.length === 0) return "is empty";
  if (path.includes("\0")) return "contains a NUL byte";
  if (isAbsolute(path)) return `is absolute (${path})`;
  if (path.includes("\\")) {
    return `contains a backslash (${path}); delivered paths are POSIX`;
  }
  const segments = path.split("/");
  if (segments.includes("..")) return `escapes the rule directory (${path})`;
  if (segments.some((segment) => segment === "." || segment.length === 0)) {
    return `is not a normalized relative path (${path})`;
  }
  const target = resolve(ruleDirectoryPath, path);
  if (
    target !== ruleDirectoryPath &&
    !target.startsWith(ruleDirectoryPath + sep)
  ) {
    return `resolves outside the rule directory (${path})`;
  }
  return undefined;
}

/**
 * Why a delivered file set is not a complete rule for `engine`, or `undefined`.
 *
 * Answered from {@link ENGINE_LAYOUTS} rather than from per-engine prose, so
 * "what a complete rule is" has one definition that both this and the
 * generator build against — the whole point of publishing the table.
 *
 * Completeness matters because every missing piece fails silently: a runtime
 * rule with no `check.ts` is never blessed and is held; a Vale rule with no
 * `.vale.ini` has no matcher enabling it and never fires. Both leave `check`
 * exiting 0, which is indistinguishable from a rule that passed.
 */
export function describeIncompleteSet(
  engine: EngineName,
  ruleId: string,
  files: readonly DeliveredFile[]
): string | undefined {
  const layout = ENGINE_LAYOUTS[engine];
  const paths = new Set(files.map((file) => file.path));

  const ruleFile = layout.ruleFile(ruleId);
  if (!paths.has(ruleFile)) {
    return `has no ${ruleFile}, which is the rule itself`;
  }

  const config = layout.ruleConfigFile;
  if (config !== undefined && !paths.has(config)) {
    return `has no ${config}; without it nothing scopes the rule and it would never fire`;
  }

  const captures = layout.capturesDirectory;
  if (captures !== undefined) {
    const prefix = `${captures}/`;
    const hasCapture = [...paths].some(
      (path) =>
        path.startsWith(prefix) &&
        (path.endsWith(".yml") || path.endsWith(".yaml"))
    );
    if (!hasCapture) {
      return `has no capture rules under ${prefix}, so ${ruleFile} would never be invoked`;
    }
  }

  return undefined;
}

/** A delivered file set that may be written, or the reason it may not. */
export type DeliveryAssessment =
  | { ok: true; files: readonly DeliveredFile[] }
  | { ok: false; reason: string };

/**
 * Decide whether a whole file set may be written, BEFORE anything is written.
 *
 * Every check runs against the set as a unit and the first failure refuses all
 * of it. A partially written rule directory is worse than none: it verifies as
 * a broken rule two steps from the cause, and the delivery that produced it has
 * already reported success.
 */
export function assessDelivery(
  cwd: string,
  engine: EngineName,
  ruleId: string,
  files: readonly DeliveredFile[]
): DeliveryAssessment {
  if (files.length === 0) {
    return { ok: false, reason: "delivered no files" };
  }
  const directory = ruleDirectory(cwd, engine, ruleId);

  // Case-FOLDED as well as exact. APFS and NTFS are case-insensitive by
  // default, so `captures/Logs.yml` and `captures/logs.yml` are two distinct
  // strings that become one file on disk: the second write silently clobbers
  // the first and the rule is missing a capture nobody was told was dropped.
  // Capture names are arbitrary, so nothing else would catch it.
  const folded = new Set<string>();
  for (const file of files) {
    const unsafe = describeUnsafePath(directory, file.path);
    if (unsafe !== undefined) {
      return { ok: false, reason: `delivered a path that ${unsafe}` };
    }
    const key = file.path.toLowerCase();
    if (folded.has(key)) {
      return {
        ok: false,
        reason:
          key === file.path
            ? `delivered ${file.path} twice`
            : `delivered ${file.path} twice, differing only in case, which is one file on a case-insensitive filesystem`,
      };
    }
    folded.add(key);
  }

  // One delivered path being an ANCESTOR of another is the same file needing
  // to be a file and a directory at once. It passes every check above — no
  // path is unsafe, none is a duplicate, the set can still be complete — and
  // then fails mid-write: `mkdir` throws `ENOTDIR` when the parent was already
  // written as a file, and `writeFile` throws `EISDIR` when a recursive
  // `mkdir` got there first. Which one depends on array order, and either way
  // the rule directory is left half-written, which is precisely the state this
  // module exists to make impossible.
  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      if (folded.has(ancestor.toLowerCase())) {
        return {
          ok: false,
          reason: `delivered ${ancestor} as both a file and a directory (with ${file.path})`,
        };
      }
    }
  }

  const incomplete = describeIncompleteSet(engine, ruleId, files);
  if (incomplete !== undefined) {
    return { ok: false, reason: `${incomplete}` };
  }

  return { ok: true, files };
}

/**
 * The one subtree inside a rule directory a delivered set does not govern.
 *
 * **`.tests/` SURVIVES A DELIVERY THAT DOES NOT MENTION IT, DELIBERATELY.**
 * Everything else under the rule directory is removed when the set omits it
 * (see {@link writeDeliveredFileSet}). Stating the exception here rather than
 * deciding it silently is the point: a fixture that vanishes surfaces later as
 * a rule that tests nothing, and nobody connects that to a delivery weeks
 * earlier.
 *
 * Two reasons, and the first is the one that matters:
 *
 * - **Nothing under `.tests/` reaches an engine.** The dot is what makes
 *   ast-grep skip the directory during rule discovery (see
 *   {@link RULE_TESTS_DIRECTORY}), `strayModules` already exempts it for the
 *   same reason, and runtime capture discovery skips it by name. A stale
 *   fixture therefore cannot change what a rule matches, which is the entire
 *   harm this purge exists to prevent. A stale fixture fails a test run loudly,
 *   in front of someone already looking at that rule.
 * - **This CLI writes files there that no delivered set will ever name.**
 *   `writeRuleTestFile` writes `<id>-<timestamp>-test.yml` on every
 *   single-content create and iterate, so fixtures accumulate locally and are
 *   absent from a later file-set delivery by construction. Purging `.tests/`
 *   would delete a rule's whole local test history the first time it was
 *   redelivered as a file set.
 *
 * Only the top-level `.tests/` is exempt. `RULE_TESTS_DIRECTORY` is defined
 * relative to the rule directory, so a nested `captures/.tests/` is not a test
 * directory — it is a file an engine reads, and it is purged like any other.
 *
 * A delivered set may still WRITE into `.tests/`; that is how a file set ships
 * its own fixtures. Exempt means "not deleted for going unmentioned", not "off
 * limits".
 */
const PRESERVED_SUBTREES = new Set<string>([RULE_TESTS_DIRECTORY]);

/** What a rule directory holds, as paths relative to it. */
interface RuleDirectoryContents {
  /** Every file and symlink the purge may consider. */
  files: string[];
  /** Every directory, so the ones left empty can be pruned. */
  directories: string[];
}

/**
 * Enumerate a rule directory, skipping the subtrees a delivered set does not
 * govern.
 *
 * Symlinks are listed as files rather than descended into. `readdir` does not
 * follow them, so `isDirectory()` is false for a link to a directory, and
 * removing the entry unlinks the link and never touches its target. That is the
 * behavior wanted here — a symlink planted inside a rule directory is exactly
 * the kind of file a repair must not preserve — and it is why this must not be
 * rewritten in terms of a following `stat`.
 */
async function readRuleDirectory(
  directory: string
): Promise<RuleDirectoryContents> {
  const files: string[] = [];
  const directories: string[] = [];

  async function walk(absolute: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      // A directory that is genuinely absent holds nothing to purge. Anything
      // else — `EACCES` above all — is a real IO problem, and reading it as
      // "empty" would report a clean repair of a directory we could not look
      // at.
      if (isMissingDirectory(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (PRESERVED_SUBTREES.has(path)) continue;
      if (entry.isDirectory()) {
        directories.push(path);
        await walk(join(absolute, entry.name), path);
        continue;
      }
      files.push(path);
    }
  }

  await walk(directory, "");
  return { files, directories };
}

/**
 * Remove everything in the rule directory the delivered set did not name.
 *
 * Bounded to `.taskless/rules/<engine>/<id>/` by construction and then by
 * check. By construction, because every candidate is DISCOVERED by walking that
 * directory rather than derived from payload content, so no string the service
 * sent can name a deletion target. By check, because each candidate still goes
 * through {@link describeUnsafePath}, the same guard delivered paths pass:
 * there is one definition of "inside this rule directory", so the guard on what
 * is written and the guard on what is removed cannot drift apart. A candidate
 * it refuses is left alone; a purge is not the place to resolve a path this
 * module already treats as unrepresentable.
 *
 * Comparison is case-FOLDED, matching {@link assessDelivery}. On a
 * case-insensitive filesystem a delivered `captures/Logs.yml` written into an
 * existing `captures/logs.yml` keeps the on-disk spelling, so an exact compare
 * would find `captures/logs.yml` unmentioned and delete the file just written —
 * leaving a rule with no capture, which verifies as incomplete and never fires.
 * The cost is on a case-sensitive filesystem, where a stale sibling differing
 * only in case is spared. That is the right way round to be wrong: sparing a
 * stale file leaves the merge behavior this change narrows, while deleting a
 * live one makes the rule inert. (`assessDelivery` already refuses a SET that
 * collides under folding, so this only ever concerns disk against delivery.)
 */
async function purgeUndeliveredFiles(
  directory: string,
  files: readonly DeliveredFile[]
): Promise<string[]> {
  const delivered = new Set(files.map((file) => file.path.toLowerCase()));
  const contents = await readRuleDirectory(directory);
  const removed: string[] = [];

  for (const path of contents.files) {
    if (delivered.has(path.toLowerCase())) continue;
    if (describeUnsafePath(directory, path) !== undefined) continue;
    const target = join(directory, path);
    await rm(target, { force: true });
    removed.push(target);
  }

  // Deepest first, so a directory emptied by pruning its children is prunable
  // in the same pass. `rmdir` rather than a recursive `rm` precisely because it
  // REFUSES a non-empty directory: one still holding a delivered file, or a
  // preserved `.tests/`, must survive, and the filesystem answering "not empty"
  // is a stronger guarantee of that than bookkeeping kept correct by hand.
  const deepestFirst = contents.directories.toSorted(
    (a, b) => b.split("/").length - a.split("/").length
  );
  for (const path of deepestFirst) {
    if (describeUnsafePath(directory, path) !== undefined) continue;
    try {
      await rmdir(join(directory, path));
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      // Still holding something, or already gone. Every other code is a real
      // IO problem and is not swallowed.
      if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT") {
        throw error;
      }
    }
  }

  return removed;
}

/** What writing a delivered file set did to the rule directory. */
export interface DeliveryWrite {
  /** Absolute paths written, sorted. */
  written: string[];
  /** Absolute paths removed for not being in the set, sorted. */
  removed: string[];
}

/**
 * Write an assessed file set into `.taskless/rules/<engine>/<id>/`, making the
 * directory MATCH the set.
 *
 * Takes the assessment rather than the raw files so it cannot be called on an
 * unchecked set: the only way to obtain the argument is to have passed
 * {@link assessDelivery}.
 *
 * **THE DELIVERED SET IS THE DIRECTORY, for every caller.** The schema calls
 * `files` "every file the rule directory must contain", so a file on disk the
 * set does not mention is not part of the rule, and writing the set over it
 * while leaving it behind contradicts the contract the payload was built
 * against. This used to merge, which was unremarkable for `rule create` (the
 * directory is normally new) and nearly so for `rule improve`, but wrong for
 * the repair in `check`: repair runs BECAUSE an `unsafe` verdict says the
 * directory diverged from what the service blessed, and only `check.ts` is
 * signed — so a leftover under `captures/` was never reported by reconcile, was
 * not replaced by the repair, and went on changing what the rule matched. The
 * rule read as repaired and was not.
 *
 * It is deliberately ONE rule for all three callers rather than a repair-only
 * mode. Either the set defines the directory or it does not, and a helper that
 * merged for two callers and purged for the third would mean `improve` leaves
 * behind exactly the stray `check` later has to remove, with "what is in this
 * rule directory" having two answers depending on which command wrote it last.
 *
 * Two properties hold this together:
 *
 * - **Nothing is removed unless the whole set was accepted.** A refused set
 *   never reaches here, so it leaves the directory exactly as it was. Assess
 *   and purge are a unit for the same reason assess and write already were: a
 *   half-purged directory is worse than a merged one.
 * - **Writes come first, deletions second.** Every delivered file is on disk
 *   before anything is unlinked, so an IO failure part-way leaves a directory
 *   that is a superset of the blessed rule — the merge behavior being narrowed,
 *   which is survivable — rather than a rule missing pieces, which verifies as
 *   incomplete or silently never fires.
 *
 * A complete set cannot leave the rule inert: {@link assessDelivery} has
 * already required the rule file, the engine config where there is one, and at
 * least one capture where the engine uses them, and all of those are written
 * before the purge runs.
 */
export async function writeDeliveredFileSet(
  cwd: string,
  engine: EngineName,
  ruleId: string,
  assessment: Extract<DeliveryAssessment, { ok: true }>
): Promise<DeliveryWrite> {
  const directory = ruleDirectory(cwd, engine, ruleId);
  const written: string[] = [];
  for (const file of assessment.files) {
    const target = join(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    written.push(target);
  }
  const removed = await purgeUndeliveredFiles(directory, assessment.files);
  return { written: written.toSorted(), removed: removed.toSorted() };
}
