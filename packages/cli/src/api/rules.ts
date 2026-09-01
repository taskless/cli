import type { paths } from "../generated/api";
import { createApiClient } from "./client";
import { getCliPrefix } from "../util/package-manager";

// --- Types extracted from the generated schema ---

type RuleStatusData =
  paths["/cli/api/rule/{ruleId}"]["get"]["responses"]["200"]["content"]["application/json"];

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

// --- Helpers ---

/** Extract error details from an untyped error response body */
function parseErrorBody(rawError: unknown): Record<string, unknown> {
  if (rawError && typeof rawError === "object") {
    return rawError as Record<string, unknown>;
  }
  return {};
}

/**
 * The server returns the same 404 `organization_not_found` whether the org
 * isn't yours or its GitHub App installation doesn't cover this repository (it
 * deliberately doesn't distinguish, to avoid leaking org existence), so the
 * message names both causes — coverage first, since a resolved org subject
 * makes membership the less likely one.
 */
function orgNotFoundMessage(): string {
  return [
    "Taskless could not act on this repository for your organization.",
    "",
    "Most often the organization's Taskless GitHub App installation does not cover this repository. It can also mean your login no longer has access to the organization.",
    "",
    "- Confirm the Taskless app is installed on this repository's owner and includes this repository.",
    `- If access recently changed, re-authenticate with \`${getCliPrefix()} auth login\`.`,
  ].join("\n");
}

// --- API functions ---

/** Submit a new rule generation request */
export async function submitRule(
  token: string,
  request: {
    /** Org subject: Taskless UUID (preferred) or numeric GitHub org id. */
    orgId: string | number;
    repositoryUrl: string;
    prompt: string;
    successCases?: string[];
    failureCases?: string[];
  }
) {
  const client = createApiClient(token);
  const { data, error, response } = await client.POST("/cli/api/rule", {
    body: request,
  });

  if (!data) {
    const errorData = parseErrorBody(error);
    if (response.status === 400 && errorData.error === "validation_error") {
      const details = (errorData.details as string[]) ?? [];
      throw new Error(`Validation error: ${details.join(", ")}`);
    }
    if (
      response.status === 403 &&
      errorData.error === "repository_not_accessible"
    ) {
      throw new Error(
        [
          "Repository is not accessible to this organization.",
          "",
          "- Verify that your local `origin` remote points to the intended GitHub repository.",
          "- Confirm that your GitHub user/organization has access to that repository.",
          `- If you recently changed access or remotes, try re-authenticating with \`${getCliPrefix()} auth login\`.`,
        ].join("\n")
      );
    }
    if (
      response.status === 404 &&
      errorData.error === "organization_not_found"
    ) {
      throw new Error(orgNotFoundMessage());
    }
    throw new Error(
      `Request submission failed (HTTP ${String(response.status)})`
    );
  }

  return data;
}

/** Poll for rule generation status */
export async function pollRuleStatus(token: string, ruleId: string) {
  const client = createApiClient(token);
  const { data, error, response } = await client.GET("/cli/api/rule/{ruleId}", {
    params: { path: { ruleId } },
  });

  if (!data) {
    const errorData = parseErrorBody(error);
    if (response.status === 403 && errorData.error === "access_denied") {
      throw new Error("Access denied to this request.");
    }
    if (response.status === 404 && errorData.error === "request_not_found") {
      throw new Error("Request not found. It may have expired.");
    }
    throw new Error(`Status polling failed (HTTP ${String(response.status)})`);
  }

  return data;
}

/** Submit an improve/iterate request for an existing rule */
export async function iterateRule(
  token: string,
  ruleId: string,
  request: {
    /** Org subject: Taskless UUID (preferred) or numeric GitHub org id. */
    orgId: string | number;
    guidance: string;
    references?: Array<{ filename: string; content: string }>;
  }
) {
  const client = createApiClient(token);
  const { data, error, response } = await client.POST(
    "/cli/api/rule/{ruleId}/iterate",
    {
      params: { path: { ruleId } },
      body: request,
    }
  );

  if (!data) {
    const errorData = parseErrorBody(error);
    if (response.status === 400 && errorData.error === "validation_error") {
      const details = (errorData.details as string[]) ?? [];
      throw new Error(`Validation error: ${details.join(", ")}`);
    }
    if (response.status === 403 && errorData.error === "access_denied") {
      throw new Error("Access denied to this request.");
    }
    if (response.status === 404 && errorData.error === "request_not_found") {
      throw new Error("Rule not found. It may have expired.");
    }
    if (
      response.status === 404 &&
      errorData.error === "organization_not_found"
    ) {
      throw new Error(orgNotFoundMessage());
    }
    throw new Error(`Iterate request failed (HTTP ${String(response.status)})`);
  }

  return data;
}
