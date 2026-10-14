import { packageFile, writeJsonArtifact } from "./artifacts";

/**
 * Vendor the ReportV1 schema tskl.es publishes, which `taskless report`
 * validates every payload against before it is sent.
 *
 * Committed for the reason `fetch-api-schema.ts` commits the API document: a
 * change to the contract arrives as a readable diff of the document itself,
 * including the `x-taskless` block that carries the publish URL, the size
 * limit, and the retry contract the client reads from it.
 *
 * Never on the build path, and it fails loudly rather than keeping the old
 * bytes: a refresh that silently kept them would report "no contract change"
 * when what happened was "no contract reached".
 */

const SOURCE_URL =
  process.env.TASKLESS_REPORT_SCHEMA_URL ?? "https://tskl.es/api/v1/schema";
const OUTPUT_PATH = packageFile("src", "generated", "report-v1.schema.json");

console.log("Fetching the tskl.es ReportV1 schema...");
console.log(`  URL: ${SOURCE_URL}`);

let response: Response;
try {
  response = await fetch(SOURCE_URL);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to reach ${SOURCE_URL}: ${message}`);
}
if (!response.ok) {
  throw new Error(`HTTP ${String(response.status)} fetching ${SOURCE_URL}`);
}

let schema: Record<string, unknown>;
try {
  schema = (await response.json()) as Record<string, unknown>;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Response from ${SOURCE_URL} was not valid JSON: ${message}`);
}

// A 200 carrying some other JSON document must not replace the contract: the
// failure would surface a step later as every report refused, with nothing
// pointing back here.
if (schema.title !== "ReportV1" || typeof schema.properties !== "object") {
  throw new Error(
    `Response from ${SOURCE_URL} is not the ReportV1 schema (title ${JSON.stringify(schema.title)})`
  );
}

await writeJsonArtifact(OUTPUT_PATH, schema);
console.log(`  Wrote ${OUTPUT_PATH}`);
