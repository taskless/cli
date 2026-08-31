import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { GeneratedRule } from "../api/rules";
import { ENGINE_LAYOUTS, type EngineName } from "./layout";
import { ruleDirectory } from "./engines";

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
 * Write an assessed file set into `.taskless/rules/<engine>/<id>/`.
 *
 * Takes the assessment rather than the raw files so it cannot be called on an
 * unchecked set: the only way to obtain the argument is to have passed
 * {@link assessDelivery}.
 */
export async function writeDeliveredFileSet(
  cwd: string,
  engine: EngineName,
  ruleId: string,
  assessment: Extract<DeliveryAssessment, { ok: true }>
): Promise<string[]> {
  const directory = ruleDirectory(cwd, engine, ruleId);
  const written: string[] = [];
  for (const file of assessment.files) {
    const target = join(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    written.push(target);
  }
  return written.toSorted();
}
