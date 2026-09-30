import createClient from "openapi-fetch";

import type { paths } from "../generated/api-v2";
import { getApiBaseUrl } from "./config";
import { parseRefusal, type Refusal } from "./refusal";
import { isRecord } from "../util/is-record";
import { CLI_VERSION, CLI_VERSION_HEADER } from "../version";

/**
 * The Taskless v2 rule API (taskless/taskless#229), typed from the vendored
 * `api-v2.schema.json`.
 *
 * Every call returns a {@link V2Outcome} and none throws for a condition the
 * service documents. That is the contract the v1 reconcile and restore clients
 * kept by staying on raw `fetch`; here it is kept by mapping the typed error
 * union to values in one place, so a caller branches on a code instead of
 * parsing a message. The version header is set on the client, so no call can
 * forget it: the service's version floor reads it, and so does the generator
 * when it decides whether to produce runtime rules for this client.
 */

type Method = "get" | "post";

type Operation<P extends keyof paths, M extends Method> = NonNullable<
  paths[P][M]
>;

type Responses<P extends keyof paths, M extends Method> =
  Operation<P, M> extends { responses: infer R } ? R : never;

type JsonOf<R> = R extends { content: { "application/json": infer B } }
  ? B
  : never;

/** The `200` body an operation documents. */
export type OkBody<P extends keyof paths, M extends Method> = JsonOf<
  Responses<P, M>[200 & keyof Responses<P, M>]
>;

type CodeOf<B> = B extends { error: infer E extends string } ? E : never;

/**
 * Every documented `error` code of an operation, except `unauthorized`, which
 * every operation shares and which gets an outcome of its own.
 */
export type ErrorCode<P extends keyof paths, M extends Method> = Exclude<
  CodeOf<JsonOf<Responses<P, M>[Exclude<keyof Responses<P, M>, 200>]>>,
  "unauthorized"
>;

/**
 * The result of a v2 call.
 *
 * - `ok`: the documented `200` body.
 * - `refused`: a recovery route answered `200` with a plan refusal. Only
 *   restore, rollback, and rule fetch can produce it.
 * - `error`: a documented error code. `details` is carried for
 *   `validation_error`, the one code the service explains.
 * - `unauthorized`: `401`. Its own outcome, because every caller answers it the
 *   same way (log in again) and it is never a verdict about the request.
 * - `unavailable`: anything the schema does not describe: a network failure, an
 *   undocumented status or code, or a body that is not what it says it is.
 */
export type V2Outcome<T, C extends string> =
  | { status: "ok"; data: T }
  | { status: "refused"; refusal: Refusal }
  | { status: "error"; code: C; httpStatus: number; details?: string[] }
  | { status: "unauthorized" }
  | { status: "unavailable"; reason: string };

/**
 * A list of an operation's error codes, checked for completeness at compile
 * time. The types are erased at runtime, so the codes a call recognizes have to
 * exist as values; this keeps that list from quietly falling behind the schema
 * when a refresh adds a code. A missing code is a type error here, not an
 * `unavailable` at 2am.
 */
function errorCodes<C extends string>() {
  return <const A extends readonly C[]>(
    codes: A & ([C] extends [A[number]] ? unknown : "missing a documented code")
  ): readonly C[] => codes;
}

/** Create the v2 client. Exported for tests that assert on the wire. */
export function createV2Client(token: string) {
  // Schema paths include the /cli/ prefix, so the base URL is the origin.
  const baseUrl = getApiBaseUrl().replace(/\/cli\/?$/, "");
  return createClient<paths>({
    baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      [CLI_VERSION_HEADER]: CLI_VERSION,
    },
  });
}

type Fetched = { data?: unknown; error?: unknown; response: Response };

/**
 * Turn an `openapi-fetch` result into an outcome.
 *
 * The thrown cases are the transport's: a network failure, and a `200` whose
 * body is not JSON (openapi-fetch parses a success body and throws on garbage,
 * where it hands an error body back as text). Both are `unavailable`.
 */
async function settle<T, C extends string>(
  call: () => Promise<Fetched>,
  codes: readonly C[],
  accept: (data: unknown) => V2Outcome<T, C>
): Promise<V2Outcome<T, C>> {
  let fetched: Fetched;
  try {
    fetched = await call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: `network error: ${message}` };
  }

  const { response } = fetched;
  if (response.status === 401) return { status: "unauthorized" };
  if (response.ok) return accept(fetched.data);

  const body = fetched.error;
  const code = isRecord(body) ? body.error : undefined;
  if (typeof code === "string" && (codes as readonly string[]).includes(code)) {
    const details =
      isRecord(body) && Array.isArray(body.details)
        ? body.details.filter(
            (detail): detail is string => typeof detail === "string"
          )
        : undefined;
    return {
      status: "error",
      code: code as C,
      httpStatus: response.status,
      ...(details === undefined ? {} : { details }),
    };
  }
  return {
    status: "unavailable",
    reason:
      typeof code === "string"
        ? `HTTP ${String(response.status)} (${code})`
        : `HTTP ${String(response.status)}`,
  };
}

/** Accept any object body as the documented shape. */
function acceptObject<T, C extends string>(data: unknown): V2Outcome<T, C> {
  if (!isRecord(data)) {
    return { status: "unavailable", reason: "invalid response body" };
  }
  return { status: "ok", data: data as T };
}

// --- Served rules: fetch, restore, rollback ---

type RestoreOk = OkBody<"/cli/api/v2/rule/{ruleId}/restore", "post">;

/** A served rule: the `200` body of fetch, restore, or rollback, minus the refusal. */
export type ServedRule = Omit<
  Extract<RestoreOk, { restoreRules: true }>,
  "restoreRules"
>;

/** One engine's file set within a {@link ServedRule}. */
export type ServedFileSet = ServedRule["rules"][number];

/**
 * Split a recovery route's `200` into a served rule or a refusal.
 *
 * Restore and rollback mark both with `restoreRules`. A fetch marks only the
 * refusal, so the served shape is recognized by carrying `rules` instead. A
 * body that is neither is `unavailable`, never an empty success.
 */
function acceptServed<C extends string>(
  data: unknown
): V2Outcome<ServedRule, C> {
  const refusal = parseRefusal(data);
  if (refusal !== undefined) return { status: "refused", refusal };
  if (
    !isRecord(data) ||
    !Array.isArray(data.rules) ||
    typeof data.ruleId !== "string" ||
    typeof data.revisionId !== "string"
  ) {
    return {
      status: "unavailable",
      reason: "the response carried neither a rule nor a refusal",
    };
  }
  const { restoreRules: _marker, ...served } = data;
  return { status: "ok", data: served as unknown as ServedRule };
}

export type FetchRuleCode = ErrorCode<"/cli/api/v2/rule/{ruleId}", "get">;

const FETCH_RULE_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/rule/{ruleId}", "get">
>()([
  "validation_error",
  "organization_not_found",
  "rule_not_found",
  "revision_not_found",
  "rule_not_restorable",
]);

/**
 * Fetch a rule's file set: its head by default, or `revision`.
 *
 * Omit `revision` for a rule a request just produced. The head is served on
 * every plan, while naming a revision, even the head's own, is a recovery read
 * that a plan without `restoreRules` is refused.
 */
export function fetchRule(
  token: string,
  ruleId: string,
  query: { repositoryUrl: string; orgId?: string | number; revision?: string }
): Promise<V2Outcome<ServedRule, FetchRuleCode>> {
  const client = createV2Client(token);
  return settle<ServedRule, FetchRuleCode>(
    () =>
      client.GET("/cli/api/v2/rule/{ruleId}", {
        params: {
          path: { ruleId },
          query: {
            repositoryUrl: query.repositoryUrl,
            ...(query.orgId === undefined
              ? {}
              : { orgId: String(query.orgId) }),
            ...(query.revision === undefined
              ? {}
              : { revision: query.revision }),
          },
        },
      }),
    FETCH_RULE_CODES,
    acceptServed
  );
}

export type RestoreCode = ErrorCode<
  "/cli/api/v2/rule/{ruleId}/restore",
  "post"
>;

const RESTORE_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/rule/{ruleId}/restore", "post">
>()([
  "validation_error",
  "organization_not_found",
  "rule_not_found",
  "rule_not_restorable",
]);

/** Ask for a rule's current revision. Never called by `check`. */
export function restoreRule(
  token: string,
  ruleId: string,
  body: { repositoryUrl: string; orgId?: string | number }
): Promise<V2Outcome<ServedRule, RestoreCode>> {
  const client = createV2Client(token);
  return settle<ServedRule, RestoreCode>(
    () =>
      client.POST("/cli/api/v2/rule/{ruleId}/restore", {
        params: { path: { ruleId } },
        body,
      }),
    RESTORE_CODES,
    acceptServed
  );
}

export type RollbackCode = ErrorCode<
  "/cli/api/v2/rule/{ruleId}/rollback",
  "post"
>;

const ROLLBACK_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/rule/{ruleId}/rollback", "post">
>()([
  "validation_error",
  "organization_not_found",
  "rule_not_found",
  "revision_not_found",
  "rule_not_restorable",
]);

/** Make an earlier revision current and receive its files. */
export function rollbackRule(
  token: string,
  ruleId: string,
  body: { repositoryUrl: string; revisionId: string; orgId?: string | number }
): Promise<V2Outcome<ServedRule, RollbackCode>> {
  const client = createV2Client(token);
  return settle<ServedRule, RollbackCode>(
    () =>
      client.POST("/cli/api/v2/rule/{ruleId}/rollback", {
        params: { path: { ruleId } },
        body,
      }),
    ROLLBACK_CODES,
    acceptServed
  );
}

/** A rule's recent revisions: the `200` body of the revisions listing. */
export type RevisionList = OkBody<"/cli/api/v2/rule/{ruleId}/revisions", "get">;

export type RevisionsCode = ErrorCode<
  "/cli/api/v2/rule/{ruleId}/revisions",
  "get"
>;

const REVISIONS_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/rule/{ruleId}/revisions", "get">
>()(["validation_error", "organization_not_found", "rule_not_found"]);

/**
 * Accept a revisions listing only when it has the documented shape. Anything
 * else is `unavailable`, never an empty list: reading a malformed body as no
 * revisions would tell the user the rule has no history.
 */
function acceptRevisions<C extends string>(
  data: unknown
): V2Outcome<RevisionList, C> {
  if (
    !isRecord(data) ||
    typeof data.ruleId !== "string" ||
    !Array.isArray(data.revisions) ||
    typeof data.truncated !== "boolean"
  ) {
    return {
      status: "unavailable",
      reason: "the response was not a revision listing",
    };
  }
  return { status: "ok", data: data as unknown as RevisionList };
}

/**
 * List a rule's recent revisions, to choose one to roll back to. Carries no
 * rule bytes, so it is served on every plan and never refused.
 */
export function listRevisions(
  token: string,
  ruleId: string,
  query: { repositoryUrl: string; orgId?: string | number }
): Promise<V2Outcome<RevisionList, RevisionsCode>> {
  const client = createV2Client(token);
  return settle<RevisionList, RevisionsCode>(
    () =>
      client.GET("/cli/api/v2/rule/{ruleId}/revisions", {
        params: {
          path: { ruleId },
          query: {
            repositoryUrl: query.repositoryUrl,
            ...(query.orgId === undefined
              ? {}
              : { orgId: String(query.orgId) }),
          },
        },
      }),
    REVISIONS_CODES,
    acceptRevisions
  );
}

// --- Generation: request, poll, iterate ---

export type RequestBody = NonNullable<
  Operation<"/cli/api/v2/request", "post">["requestBody"]
>["content"]["application/json"];

export type RequestAccepted = OkBody<"/cli/api/v2/request", "post">;

export type RequestCode = ErrorCode<"/cli/api/v2/request", "post">;

const REQUEST_CODES = errorCodes<ErrorCode<"/cli/api/v2/request", "post">>()([
  "validation_error",
  "organization_not_found",
  "enqueue_failed",
]);

/** Create a generation request. */
export function submitRequest(
  token: string,
  body: RequestBody
): Promise<V2Outcome<RequestAccepted, RequestCode>> {
  const client = createV2Client(token);
  return settle<RequestAccepted, RequestCode>(
    () => client.POST("/cli/api/v2/request", { body }),
    REQUEST_CODES,
    acceptObject
  );
}

export type RequestStatus = OkBody<"/cli/api/v2/request/{requestId}", "get">;

export type RequestStatusCode = ErrorCode<
  "/cli/api/v2/request/{requestId}",
  "get"
>;

const REQUEST_STATUS_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/request/{requestId}", "get">
>()(["validation_error", "organization_not_found", "request_not_found"]);

/** Poll a generation request. Returns rule ids and revisions, never content. */
export function getRequestStatus(
  token: string,
  requestId: string,
  query: { repositoryUrl: string; orgId?: string | number }
): Promise<V2Outcome<RequestStatus, RequestStatusCode>> {
  const client = createV2Client(token);
  return settle<RequestStatus, RequestStatusCode>(
    () =>
      client.GET("/cli/api/v2/request/{requestId}", {
        params: {
          path: { requestId },
          query: {
            repositoryUrl: query.repositoryUrl,
            ...(query.orgId === undefined
              ? {}
              : { orgId: String(query.orgId) }),
          },
        },
      }),
    REQUEST_STATUS_CODES,
    acceptObject
  );
}

export type IterateBody = NonNullable<
  Operation<"/cli/api/v2/rule/{ruleId}/iterate", "post">["requestBody"]
>["content"]["application/json"];

export type IterateCode = ErrorCode<
  "/cli/api/v2/rule/{ruleId}/iterate",
  "post"
>;

const ITERATE_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/rule/{ruleId}/iterate", "post">
>()([
  "validation_error",
  "organization_not_found",
  "rule_not_found",
  "enqueue_failed",
]);

/** Ask for a new revision of a rule. Creates a new request to poll. */
export function iterateRule(
  token: string,
  ruleId: string,
  body: IterateBody
): Promise<V2Outcome<RequestAccepted, IterateCode>> {
  const client = createV2Client(token);
  return settle<RequestAccepted, IterateCode>(
    () =>
      client.POST("/cli/api/v2/rule/{ruleId}/iterate", {
        params: { path: { ruleId } },
        body,
      }),
    ITERATE_CODES,
    acceptObject
  );
}

// --- Reconcile and identity ---

export type ReconcileBody = NonNullable<
  Operation<"/cli/api/v2/reconcile", "post">["requestBody"]
>["content"]["application/json"];

export type ReconcileResult = OkBody<"/cli/api/v2/reconcile", "post">;

export type ReconcileCode = ErrorCode<"/cli/api/v2/reconcile", "post">;

const RECONCILE_CODES = errorCodes<
  ErrorCode<"/cli/api/v2/reconcile", "post">
>()(["validation_error", "organization_not_found"]);

/**
 * Report every rule the client holds and receive a verdict for each.
 *
 * The body is returned as the service sent it, checked only for being an
 * object. Turning it into dispositions, including the accounting that fails a
 * reported rule the response never mentions, belongs to the caller: a
 * shape-check here would be a second, weaker version of that accounting.
 */
export function reconcileRules(
  token: string,
  body: ReconcileBody
): Promise<V2Outcome<ReconcileResult, ReconcileCode>> {
  const client = createV2Client(token);
  return settle<ReconcileResult, ReconcileCode>(
    () => client.POST("/cli/api/v2/reconcile", { body }),
    RECONCILE_CODES,
    acceptObject
  );
}

export type WhoamiResult = OkBody<"/cli/api/v2/whoami", "get">;

/** Identity and organizations for the token. */
export function whoami(token: string): Promise<V2Outcome<WhoamiResult, never>> {
  const client = createV2Client(token);
  return settle<WhoamiResult, never>(
    () => client.GET("/cli/api/v2/whoami"),
    [] as readonly never[],
    acceptObject
  );
}
