import { existsSync } from "node:fs";

import { apiBaseUrl, packageFile, writeJsonArtifact } from "./artifacts";

/**
 * Vendor the Taskless CLI API's OpenAPI document next to the types generated
 * from it.
 *
 * `generate:api` used to pipe the live `__schema` straight into
 * `openapi-typescript`, which meant the only committed record of the contract
 * was `api.d.ts`. That is a poor place to notice a change. A path being
 * renamed, a field being deprecated, or a response gaining a variant all
 * arrive as type churn — hundreds of lines of regenerated declarations — and
 * the sentence the service wrote to explain the change (`deprecated: true`,
 * the description on the new field) is not in the generated types at all.
 *
 * Committing the document itself makes the refresh reviewable: `pnpm
 * --filter @taskless/cli generate:api` writes both files, and the diff on
 * `api.schema.json` is the API's own account of what changed.
 *
 * Two deliberate choices:
 *
 * - **No timestamp, no provenance banner.** `fetch-ast-grep-schema.ts` stamps
 *   its output with the time it ran, which is fine for a file keyed to a
 *   pinned version and wrong here: it would make every refresh produce a diff
 *   even when the contract is byte-identical, and a diff that is always
 *   non-empty is one nobody reads. An unchanged API must produce no change.
 *   That rules out a timestamp we would add, and equally one the service
 *   already put in the document — see the build-stamp strip below. The
 *   output is prettier-formatted for the same reason: `JSON.stringify` alone
 *   would leave a few hundred lines of formatting churn behind on a refresh
 *   that changed nothing. See `writeJsonArtifact`.
 * - **Fail loudly, never fall back.** `fetch-rule-hash-vectors.ts` degrades to
 *   its committed cache because it runs in `prebuild` and must not break an
 *   offline build. This script is never on the build path; it is only ever run
 *   on purpose. A refresh that silently kept the old bytes would report
 *   "no API changes" when what actually happened was "no API reached".
 */

const OUTPUT_PATH = packageFile("src", "generated", "api.schema.json");

// `__schema` is unauthenticated. `apiBaseUrl` documents the one tier of the
// runtime client's origin resolution these scripts skip.
const sourceUrl = `${apiBaseUrl()}/cli/api/__schema`;

console.log(`Fetching the Taskless CLI API schema...`);
console.log(`  URL: ${sourceUrl}`);

let response: Response;
try {
  response = await fetch(sourceUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to reach ${sourceUrl}: ${message}`);
}

if (!response.ok) {
  if (existsSync(OUTPUT_PATH)) {
    console.error("  Existing vendored schema left untouched.");
  }
  throw new Error(`HTTP ${String(response.status)} fetching ${sourceUrl}`);
}

let schema: Record<string, unknown>;
try {
  schema = (await response.json()) as Record<string, unknown>;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Response from ${sourceUrl} was not valid JSON: ${message}`);
}

// A 200 carrying a proxy error page parses as JSON but is not an OpenAPI
// document. Overwriting the vendored contract with one would be worse than any
// network failure, because it fails at `openapi-typescript` a step later with
// nothing pointing back at the cause.
if (!schema.openapi || typeof schema.paths !== "object") {
  throw new Error(
    `Response from ${sourceUrl} is not an OpenAPI document (no "openapi"/"paths")`
  );
}

// The service builds its own `info.version` from its deploy time —
// `0.0.1-private.20260901234218` — so two fetches minutes apart differ in that
// one field and in nothing else. Measured: a refresh 19 minutes after the
// vendored copy was taken produced a diff of exactly one line, the version.
// Keeping it verbatim would give this file the always-non-empty diff the
// docstring above exists to avoid, so drop the build stamp and keep the
// version it qualifies. A real version bump still shows up; if the service
// ever changes the shape of the suffix, nothing is stripped and the churn
// comes back visibly rather than the wrong thing being discarded silently.
const BUILD_STAMP = /\.\d{14}$/;

const info = schema.info;
if (info && typeof info === "object" && !Array.isArray(info)) {
  const version = (info as Record<string, unknown>).version;
  if (typeof version === "string" && BUILD_STAMP.test(version)) {
    (info as Record<string, unknown>).version = version.replace(
      BUILD_STAMP,
      ""
    );
  }
}

await writeJsonArtifact(OUTPUT_PATH, schema);

const paths = Object.keys(schema.paths as Record<string, unknown>);
console.log(`  Wrote ${String(paths.length)} paths to: ${OUTPUT_PATH}`);
