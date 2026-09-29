import type { paths } from "../generated/api";

// --- Types extracted from the generated schema ---

type RuleStatusData =
  paths["/cli/api/request/{requestId}"]["get"]["responses"]["200"]["content"]["application/json"];

/** A single generated rule from the API */
export type GeneratedRule = NonNullable<RuleStatusData["rules"]>[number];

/** Sidecar metadata keyed by rule filename */
export type RuleMetadata = NonNullable<RuleStatusData["meta"]>;

/**
 * A rule delivered as a file set, discriminated on `engine`.
 *
 * The service now publishes `rules` as a union rather than one shape with
 * optional fields, so `rule.content` no longer type-checks without asking
 * which variant this is. That is the schema working: a runtime file set
 * REQUIRES a signature, and a type that let every field be read off any
 * variant could not express that.
 */
export type DeliveredFileSetRule = Extract<GeneratedRule, { files: unknown }>;

/** A rule delivered as one `content` object, the pre-file-set envelope. */
export type SingleContentRule = Exclude<GeneratedRule, { files: unknown }>;

/**
 * Whether this rule arrived as a file set.
 *
 * Keyed on `files` rather than on `engine`, because `engine` is what the
 * file-set variants have in COMMON and `files` is what separates them from the
 * single-content one. Narrowing on the wrong field reads as equivalent and
 * silently admits a shape the branch cannot handle.
 */
export function isFileSetRule(
  rule: GeneratedRule
): rule is DeliveredFileSetRule {
  return (rule as { files?: unknown }).files !== undefined;
}

/** Whether this rule arrived as a single `content` object. */
export function isSingleContentRule(
  rule: GeneratedRule
): rule is SingleContentRule {
  return !isFileSetRule(rule);
}
