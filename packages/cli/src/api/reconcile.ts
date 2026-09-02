import { getApiBaseUrl } from "./config";
import { CLI_VERSION, CLI_VERSION_HEADER } from "../version";

/**
 * Server-owned rule reconciliation (TSKL-270). The CLI reports the rule files
 * it holds and the server returns the exact subset that may run. The endpoint
 * is now in the generated schema, but this stays on hand-typed plain `fetch`
 * for its degradation contract (`ReconcileOutcome` never throws for expected
 * network/auth/deployment conditions, so `check` falls back to a local scan);
 * migrating it onto the typed client would mean re-expressing that handling.
 */

/** A rule file reported for reconciliation. */
export interface ReportedFile {
  file: string;
  signature: string;
}

export interface ReconcileRequest {
  /**
   * Org subject: Taskless UUID (preferred) or numeric GitHub org id. Optional —
   * the server falls back to the deprecated token claim when it is absent.
   */
  orgId?: string | number;
  repositoryUrl: string;
  files: ReportedFile[];
}

/** A file the server blessed — execute exactly these. */
export interface RunEntry {
  ruleId: string;
  file: string;
  signature: string;
}

/** A held rule whose content differs from what the server blessed. */
export interface UnsafeEntry {
  ruleId: string;
  file: string;
  expected: string;
  got: string;
}

/** A reported file the server never issued. */
export interface UnknownEntry {
  file: string;
}

/** A rule the server expected that the client did not report. */
export interface MissingEntry {
  ruleId: string;
  file: string;
}

export interface ReconcileResponse {
  run: RunEntry[];
  unsafe: UnsafeEntry[];
  unknown: UnknownEntry[];
  missing: MissingEntry[];
}

/**
 * The result of an attempted reconciliation. `check` branches on this:
 * - `ok`: use `result.run` as the complete allow-list; warn on the rest.
 * - `unauthorized`: the token was missing/invalid (server returned 401).
 * - `unavailable`: the endpoint could not be reached or is not deployed —
 *   degrade to a local scan. Never a thrown error for these expected cases.
 */
export type ReconcileOutcome =
  | { status: "ok"; result: ReconcileResponse }
  | { status: "unauthorized" }
  | { status: "unavailable"; reason: string };

/** Coerce an untyped bucket into a typed array, tolerating a missing field. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Reconcile the reported files against the server. Returns a `ReconcileOutcome`
 * and never throws for expected network/auth/deployment conditions.
 */
export async function reconcile(
  token: string,
  request: ReconcileRequest
): Promise<ReconcileOutcome> {
  // Schema paths include the /cli/ prefix, so the base URL is the origin.
  const baseUrl = getApiBaseUrl().replace(/\/cli\/?$/, "");
  const url = `${baseUrl}/cli/api/reconcile`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        [CLI_VERSION_HEADER]: CLI_VERSION,
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: `network error: ${message}` };
  }

  if (response.status === 401) {
    return { status: "unauthorized" };
  }

  // 404 (endpoint not deployed), 5xx, and any other non-2xx are treated as
  // "unavailable" so `check` degrades to a local scan rather than failing.
  if (!response.ok) {
    return {
      status: "unavailable",
      reason: `HTTP ${String(response.status)}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", reason: "invalid response body" };
  }

  const data = body as Partial<ReconcileResponse>;
  return {
    status: "ok",
    result: {
      run: asArray<RunEntry>(data.run),
      unsafe: asArray<UnsafeEntry>(data.unsafe),
      unknown: asArray<UnknownEntry>(data.unknown),
      missing: asArray<MissingEntry>(data.missing),
    },
  };
}
