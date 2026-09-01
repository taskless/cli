import type { paths } from "../generated/api";
import { getApiBaseUrl } from "./config";
import { CLI_VERSION, CLI_VERSION_HEADER } from "../version";

/**
 * Fetch the blessed bytes for a rule the client holds wrongly, or not at all.
 *
 * This is the repair path for reconcile's verdicts, and it is deliberately not
 * an upgrade path. `unsafe` means the server holds bytes we have drifted from;
 * `missing` means it expected a rule we never reported. Both are answered by
 * "send me what you blessed". `unknown` is not: a file the service never issued
 * has nothing to fetch, which is why its entry carries no rule id.
 *
 * NOTHING RESTORED RUNS IN THE PASS THAT RESTORED IT. Restore rewrites the
 * working tree and promotes nothing into the current run: an `unsafe` rule
 * stays unexecuted, a `missing` rule was never a local candidate, and an
 * `unknown` rule never runs. The next `check` reports the repaired signature
 * and is blessed through the ordinary path. Fetching bytes and executing them
 * in the same breath as discovering drift would move the gate, and the gate is
 * the only reason any of this exists.
 */

type RestoreResponse =
  paths["/cli/api/rule/{ruleId}/restore"]["post"]["responses"]["200"]["content"]["application/json"];

/** A rule as the service restored it, discriminated on `engine`. */
export type RestoredRule = NonNullable<RestoreResponse["rules"]>[number];

/**
 * The result of an attempted restore.
 *
 * Mirrors `ReconcileOutcome`: expected conditions are values rather than
 * thrown errors, because a repair that cannot happen must degrade `check` to
 * "this rule was not repaired and did not run" rather than failing the run. A
 * rule the service will not return is a rule that stays withheld, which is
 * already a safe state.
 */
export type RestoreOutcome =
  | { status: "ok"; rules: RestoredRule[] }
  | { status: "unauthorized" }
  | { status: "unavailable"; reason: string };

/**
 * Ask the service for a rule's complete file set.
 *
 * A `POST` carrying `repositoryUrl`, which is what scopes the response to the
 * organization and installation that owns the rule rather than to whoever holds
 * a rule id. The verb follows that requirement rather than the other way round.
 */
export async function restoreRule(
  token: string,
  request: { ruleId: string; repositoryUrl: string }
): Promise<RestoreOutcome> {
  // Schema paths include the /cli/ prefix, so the base URL is the origin.
  const baseUrl = getApiBaseUrl().replace(/\/cli\/?$/, "");
  const url = `${baseUrl}/cli/api/rule/${encodeURIComponent(request.ruleId)}/restore`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        [CLI_VERSION_HEADER]: CLI_VERSION,
      },
      body: JSON.stringify({ repositoryUrl: request.repositoryUrl }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: `network error: ${message}` };
  }

  if (response.status === 401) return { status: "unauthorized" };
  if (!response.ok) {
    return { status: "unavailable", reason: `HTTP ${String(response.status)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", reason: "invalid response body" };
  }

  const data = body as Partial<RestoreResponse>;
  const rules = data.rules;
  if (!Array.isArray(rules)) {
    return { status: "unavailable", reason: "response carried no `rules`" };
  }
  return { status: "ok", rules };
}
