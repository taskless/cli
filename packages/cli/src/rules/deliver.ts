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

/** Read a delivered rule's file set, or `undefined` for a legacy single-rule payload. */
export function deliveredFiles(
  rule: GeneratedRule
): DeliveredFile[] | undefined {
  const candidate = (rule as { files?: unknown }).files;
  if (!Array.isArray(candidate)) return undefined;
  return candidate.every(
    (file): file is DeliveredFile =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as DeliveredFile).path === "string" &&
      typeof (file as DeliveredFile).content === "string"
  )
    ? candidate
    : [];
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

  const seen = new Set<string>();
  for (const file of files) {
    const unsafe = describeUnsafePath(directory, file.path);
    if (unsafe !== undefined) {
      return { ok: false, reason: `delivered a path that ${unsafe}` };
    }
    if (seen.has(file.path)) {
      return { ok: false, reason: `delivered ${file.path} twice` };
    }
    seen.add(file.path);
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
