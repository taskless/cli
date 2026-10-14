import { z } from "zod";

import reportSchemaDocument from "../generated/report-v1.schema.json";

/**
 * ReportV1, as tskl.es publishes it, and the publish contract it carries.
 *
 * The vendored document is the single source for both. Validation is built
 * from it with `z.fromJSONSchema()` rather than hand-written, so a refresh of
 * the document (`pnpm --filter @taskless/cli generate:report-schema`) is the
 * whole change when tskl.es moves, and a payload this CLI accepts is one
 * tskl.es's own schema accepts. The publish URL, the size limit and the error
 * vocabulary are read from its `x-taskless` block for the same reason.
 */

const validator = z.fromJSONSchema(
  reportSchemaDocument as unknown as Parameters<typeof z.fromJSONSchema>[0]
);

const publishContract = (
  reportSchemaDocument as unknown as {
    "x-taskless": { publish: { url: string; maxBytes: number } };
  }
)["x-taskless"].publish;

/** Where a report is published, unless overridden for tests. */
export const REPORT_PUBLISH_URL: string = publishContract.url;

/** The largest body tskl.es reads, in bytes. */
export const REPORT_MAX_BYTES: number = publishContract.maxBytes;

/**
 * The longest fixture tskl.es accepts, read from the schema's own limit on
 * `rules[].tests.fail.code`, so a refreshed limit needs no edit here.
 */
export const REPORT_FIXTURE_MAX_LENGTH: number = (
  reportSchemaDocument as unknown as {
    properties: {
      rules: {
        items: {
          properties: {
            tests: {
              properties: {
                fail: {
                  anyOf: [{ properties: { code: { maxLength: number } } }];
                };
              };
            };
          };
        };
      };
    };
  }
).properties.rules.items.properties.tests.properties.fail.anyOf[0].properties
  .code.maxLength;

/** Every way a payload fails the vendored schema, one `path: message` each. */
export function reportSchemaIssues(payload: unknown): string[] {
  const result = validator.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) =>
      `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`
  );
}
