import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";

import { isMissingDirectory } from "./errno";

/**
 * The two questions every engine's fixture reader asks, answered once.
 *
 * Three engines verify a rule against fixtures — `sg` over `valid:`/`invalid:`
 * keys in ast-grep test YAML, `vale` over `pass/`/`fail/` documents, `runtime`
 * over `pass/`/`fail/` case directories — and all three had their own copy of
 * the same two decisions. The copies were near-verbatim, which is worse than
 * different: a comment in `rules/vale/verify.ts` claimed to be "the single
 * place that decides which `readdir` failures are absence and which are
 * problems, so no caller can accidentally answer that question differently",
 * and a third copy made that sentence false the day it was written.
 *
 * What is shared here is only what is genuinely the same. What each engine
 * REJECTS is not: Vale's buckets hold documents, so a nested directory is the
 * error; runtime's hold one directory per case, so a loose file is. Those stay
 * beside their engines, where the reason for them is legible.
 */

/**
 * Directory entries, with a directory that is not there reading as an empty one.
 *
 * The single place that decides which `readdir` failures are absence and which
 * are problems. Buckets are read independently, and this discrimination is why
 * that is safe: swallowing an `EACCES` on `pass/` would yield `[]` while
 * `fail/` still had fixtures, so the rule would not look one-sided and could
 * report a pass having never checked the pass side at all. A permissions
 * problem must not read as "no pass fixtures were written".
 */
export async function bucketEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }
}

/**
 * Which fixture buckets a rule actually populated, over that engine's bucket
 * names.
 *
 * Four states rather than a boolean, because a caller wants to say different
 * things about them: `"none"` is an unwritten rule, while a `-only` is a
 * half-written one, which is the more misleading of the two. A rule with only
 * failing fixtures has shown it fires and not that it stays quiet; a rule with
 * only passing ones has shown the opposite. Only `"both"` can reach a pass.
 *
 * Parameterised on the bucket names rather than fixed to `pass`/`fail` because
 * `sg`'s buckets are the `valid:`/`invalid:` keys of ast-grep's own test YAML,
 * and its vocabulary is ast-grep's rather than ours.
 */
export type FixtureCoverage<Bucket extends string> =
  | "both"
  | `${Bucket}-only`
  | "none";

/**
 * Classify a rule's buckets by how many fixtures each held.
 *
 * `positive` is the bucket asserting the rule stays quiet (`pass`, `valid`) and
 * `negative` the one asserting it fires (`fail`, `invalid`).
 */
export function classifyCoverage<
  Positive extends string,
  Negative extends string,
>(
  positive: { name: Positive; count: number },
  negative: { name: Negative; count: number }
): FixtureCoverage<Positive | Negative> {
  if (positive.count > 0 && negative.count > 0) return "both";
  if (positive.count > 0) return `${positive.name}-only`;
  if (negative.count > 0) return `${negative.name}-only`;
  return "none";
}

/**
 * What `test` says about coverage that is not `"both"`, or nothing when it is.
 *
 * `suffix` is how that engine spells a bucket, and it genuinely differs rather
 * than having drifted: Vale's and runtime's buckets are directories, so they
 * read `pass/`; ast-grep's are keys in a YAML document, so they read `valid:`.
 * Naming a bucket in the shape the author will go and look for it is the point
 * of the message, so the difference is a parameter rather than something to
 * normalise away.
 */
export function describeCoverageShortfall(
  ruleId: string,
  coverage: FixtureCoverage<string>,
  suffix: "/" | ":"
): string | undefined {
  if (coverage === "both") return undefined;
  return coverage === "none"
    ? `${ruleId} has no fixtures, so nothing shows it fires or stays quiet.`
    : `${ruleId} has only ${coverage.replace("-only", "")}${suffix} fixtures — half a claim.`;
}
