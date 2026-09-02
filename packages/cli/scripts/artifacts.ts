import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { format, resolveConfig } from "prettier";

/**
 * Shared plumbing for the scripts that vendor a generated artifact into the
 * package: `fetch-api-schema.ts`, `fetch-ast-grep-schema.ts` and
 * `fetch-rule-hash-vectors.ts`.
 *
 * Only the parts that are genuinely the same in every script live here. The
 * three differ in what they do when the network fails, and that difference is
 * the design rather than an inconsistency to iron out: the two hand-run
 * scripts must fail loudly, and `fetch-rule-hash-vectors.ts` must not, because
 * it runs in `prebuild`. Error handling is therefore deliberately *not* shared.
 */

/** Absolute path to a file in this package, from segments relative to its root. */
export function packageFile(...segments: string[]): string {
  return resolve(import.meta.dirname, "..", ...segments);
}

/**
 * The origin the vendoring scripts fetch from.
 *
 * This is the runtime client's resolution (`getApiBaseUrl` in
 * `src/api/config.ts`) minus one tier. The runtime reads
 * `TASKLESS_API_URL` > `config.json` `apiUrl` > default; this reads the first
 * and the last, and never looks at `config.json`.
 *
 * That gap is stated rather than closed, on purpose. Closing it would mean
 * importing CLI runtime code into a build script, and these scripts are only
 * ever run by hand or in `prebuild`, where an env var is the natural way to
 * point somewhere else. Know the consequence, because it is quiet: a developer
 * pointed at staging *purely* through `config.json` vendors production instead,
 * with no warning, and the resulting diff reads as a real API change. If you
 * are on a non-production deployment, set `TASKLESS_API_URL` before refreshing.
 */
export function apiBaseUrl(): string {
  return (
    process.env.TASKLESS_API_URL ?? "https://app.taskless.io/cli"
  ).replace(/\/cli\/?$/, "");
}

/**
 * Write a JSON artifact the way the committed copy is formatted.
 *
 * `JSON.stringify(value, null, 2)` is not that format. Prettier collapses
 * short arrays onto one line and `JSON.stringify` never does, so a refresh
 * that changed nothing still produced a few hundred lines of diff, which
 * lint-staged then silently undid at commit time. That churn is exactly what
 * `fetch-api-schema.ts` is designed to avoid — its whole argument for
 * vendoring the document is that the diff is readable — and a diff nobody can
 * read is no better than one nobody sees. Formatting here makes "run the
 * script, see an empty diff" true at the moment the script runs, which is the
 * moment somebody is looking.
 */
export async function writeJsonArtifact(
  path: string,
  value: unknown
): Promise<void> {
  const options = await resolveConfig(path);
  const formatted = await format(JSON.stringify(value, null, 2), {
    ...options,
    filepath: path,
  });
  writeFileSync(path, formatted, "utf8");
}
