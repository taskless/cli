import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * - **Fail loudly, never fall back.** `fetch-rule-hash-vectors.ts` degrades to
 *   its committed cache because it runs in `prebuild` and must not break an
 *   offline build. This script is never on the build path; it is only ever run
 *   on purpose. A refresh that silently kept the old bytes would report
 *   "no API changes" when what actually happened was "no API reached".
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(
  __dirname,
  "..",
  "src",
  "generated",
  "api.schema.json"
);

// Resolve the API origin the same way the runtime client does: honor
// TASKLESS_API_URL, else the production default. `__schema` is unauthenticated.
const baseUrl = (
  process.env.TASKLESS_API_URL ?? "https://app.taskless.io/cli"
).replace(/\/cli\/?$/, "");
const sourceUrl = `${baseUrl}/cli/api/__schema`;

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

writeFileSync(OUTPUT_PATH, JSON.stringify(schema, null, 2) + "\n", "utf8");

const paths = Object.keys(schema.paths as Record<string, unknown>);
console.log(`  Wrote ${String(paths.length)} paths to: ${OUTPUT_PATH}`);
