import {
  fetchRule,
  getRequestStatus,
  type RequestStatus,
  type ServedFileSet,
  type ServedRule,
} from "../api/v2";
import { notRunOnPlanSentence, parseEntitlementV2 } from "../api/entitlement";
import { describeRefusal, stripControlCharacters } from "../api/refusal";
import { rejectedTokenRemedy } from "../auth/token";
import { CLIError } from "../util/cli-error";
import { getCliPrefix } from "../util/package-manager";
import {
  prepareServedRule,
  writePreparedRule,
  type PreparedRule,
} from "./files";
import { verifyServedRule } from "./verify-delivery";

/**
 * The v2 generation flow `rule create` and `rule improve` share: poll a
 * request to an end state, fetch each rule it produced by its own id, verify
 * the bytes, and write.
 *
 * v2 polling returns `{ ruleId, revisionId }` pairs and never content, which is
 * what makes a rule addressable after the request that produced it is
 * forgotten. The content comes from `GET rule/{ruleId}`, fetched WITHOUT
 * `revision`: a just-generated rule is its rule's head, and the head is served
 * on every plan, whereas naming a revision is a recovery read that a Free
 * organization is refused. The `revisionId` from polling is then how the CLI
 * knows the head it got is the revision it asked for.
 */

/** Where a generation request is, and how to reach it. */
export interface GenerationContext {
  token: string;
  repositoryUrl: string;
  orgId?: string | number;
  /** Progress lines for a human; never part of `--json` output. */
  onProgress: (message: string) => void;
  /**
   * The command that picks this request up again without submitting a new
   * one, named whenever the CLI stops waiting on a request that may still
   * finish.
   */
  resumeCommand: string;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * How many retryable `unavailable` outcomes in a row a poll or a rule fetch
 * absorbs before giving up: about two minutes at `POLL_INTERVAL_MS`, enough to
 * ride out a deploy or a rate limit without hammering a service that is
 * telling the CLI to back off. Any answer that is not `unavailable` resets the
 * count, so it measures one outage, not the request's whole life.
 */
const MAX_CONSECUTIVE_UNAVAILABLE = 8;

/** Wait between attempts. Tests collapse it by stubbing `setTimeout`. */
async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

/**
 * The sentences for a request the CLI stopped watching. Giving up on a poll
 * cancels nothing on the service, so the request may still finish, and
 * running the command again without `--resume` is a SECOND request rather
 * than a retry of this one.
 */
function abandonedRequestAdvice(
  context: GenerationContext,
  requestId: string
): string {
  return ` Request ${requestId} was not cancelled and may still complete on the service. Run \`${context.resumeCommand}\` to keep waiting for it; running the command without \`--resume\` submits a new request.`;
}

/**
 * The service returns the same 404 `organization_not_found` whether the org
 * isn't yours or its GitHub App installation doesn't cover this repository (it
 * deliberately doesn't distinguish, to avoid leaking org existence), so the
 * message names both causes — coverage first, since a resolved org subject
 * makes membership the less likely one.
 */
export function orgNotFoundMessage(): string {
  return [
    "Taskless could not act on this repository for your organization.",
    "",
    "Most often the organization's Taskless GitHub App installation does not cover this repository. It can also mean your login no longer has access to the organization.",
    "",
    ...orgNotFoundRemedy().map((step) => `- ${step}`),
  ].join("\n");
}

/**
 * The steps that resolve `organization_not_found`, one sentence each. Shared
 * with `check`, which reports the same condition and must name the same
 * remedy.
 */
export function orgNotFoundRemedy(): string[] {
  return [
    "Confirm the Taskless app is installed on this repository's owner and includes this repository.",
    `If access recently changed, re-authenticate with \`${getCliPrefix()} auth logout\` then \`${getCliPrefix()} auth login\`.`,
  ];
}

/** A request's terminal status. */
export type FinishedRequest = RequestStatus;

/**
 * Poll a request until it stops moving.
 *
 * A retryable `unavailable` (a network failure, `408`, `429`, or a `5xx`) is
 * not an answer about the request either, but it is one a later poll may not
 * repeat, so polling carries on through up to `MAX_CONSECUTIVE_UNAVAILABLE` of
 * them in a row.
 *
 * Throws a `CLIError` for anything that is not an answer about the request:
 * `request_not_found` (the id will never resolve, reported as `NETWORK_ERROR`
 * because the remedy is to resubmit), a rejected token, and a service that
 * stayed unreachable or answered with something unreadable, each with the
 * code a caller branches on.
 */
export async function awaitRequest(
  context: GenerationContext,
  requestId: string
): Promise<FinishedRequest> {
  let unavailable = 0;
  while (true) {
    await pause();

    const outcome = await getRequestStatus(context.token, requestId, {
      repositoryUrl: context.repositoryUrl,
      ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
    });
    if (outcome.status !== "unavailable") unavailable = 0;
    switch (outcome.status) {
      case "ok": {
        break;
      }
      case "unauthorized": {
        throw new CLIError(
          `Polling failed: authentication was rejected. ${rejectedTokenRemedy()}`,
          "AUTH_REQUIRED"
        );
      }
      case "error": {
        // `request_not_found` names the request id this CLI submitted a moment
        // ago, never a rule id the caller supplied, so it is not
        // RULE_NOT_FOUND: that code's documented remedy is "re-check the
        // directory name", and `rule create` has no rule id at all. It is a
        // poll that failed, and the remedy is to submit again.
        throw new CLIError(
          outcome.code === "request_not_found"
            ? `Request ${requestId} is no longer known to the service for this repository. Submit the request again.`
            : `Polling failed (${outcome.code}).`,
          "NETWORK_ERROR"
        );
      }
      case "refused": {
        throw new CLIError(
          "Polling failed: unexpected refusal.",
          "NETWORK_ERROR"
        );
      }
      case "unavailable": {
        unavailable += 1;
        if (outcome.retryable && unavailable < MAX_CONSECUTIVE_UNAVAILABLE) {
          context.onProgress(
            `Status check failed (${outcome.reason}); retrying (${String(unavailable)}/${String(MAX_CONSECUTIVE_UNAVAILABLE - 1)})...`
          );
          continue;
        }
        throw new CLIError(
          `Polling failed: ${outcome.reason}${outcome.retryable ? `, ${String(unavailable)} times in a row` : ""}.${abandonedRequestAdvice(context, requestId)}`,
          "NETWORK_ERROR"
        );
      }
    }

    const status = outcome.data;
    switch (status.status) {
      case "accepted": {
        context.onProgress("Status: accepted — waiting for processing...");
        continue;
      }
      case "classifying": {
        context.onProgress("Status: classifying — analyzing your request...");
        continue;
      }
      case "building": {
        context.onProgress("Status: building — generating rules...");
        continue;
      }
      default: {
        return status;
      }
    }
  }
}

/**
 * The server-authored reason a request ended without rules, safe to print.
 *
 * `error` carries plan refusals (`REMOTE_GENERATION_NOT_IN_PLAN`) and, later,
 * `CLI_UPGRADE_REQUIRED`. It is printed as given, minus control characters,
 * because it is written to a terminal from across the network.
 */
export function requestErrorText(status: FinishedRequest): string | undefined {
  const text = status.error?.trim();
  return text === undefined || text === ""
    ? undefined
    : stripControlCharacters(text);
}

/** What delivering a finished request wrote. */
export interface Delivered {
  /** Rule ids written, in the order the request listed them. */
  rules: string[];
  /** The rule file of each rule written. */
  files: string[];
  /** Advisory messages about rules that were still written. */
  notices: string[];
}

/**
 * Fetch, verify, check, then write every rule a request produced.
 *
 * Every rule is fetched, verified against its signatures, and checked as a
 * writable rule (its id, its engine, and its file set's paths and
 * completeness) before ANY is written. A request whose second rule fails any
 * of those leaves the tree exactly as it was, rather than holding half a
 * delivery the command then reports as nothing.
 *
 * What this does not cover is an IO failure part-way through the writes
 * themselves (a full disk, say): the rules written before it stay written.
 */
export async function deliverRevisions(
  cwd: string,
  context: GenerationContext,
  requestId: string,
  revisions: FinishedRequest["revisions"]
): Promise<Delivered> {
  // The contract requires `revisions` on every status, but `getRequestStatus`
  // only checks that the body is an object. A `generated` status without the
  // list is a malformed response, reported the way `api/v2.ts` reports any
  // other one. Not `?? []`: that would print "0 rule(s)" and exit cleanly for
  // a request that did generate something, a silent success.
  if (!Array.isArray(revisions)) {
    throw new CLIError(
      "The service reported the request as generated but did not list the rules it produced (invalid response body).",
      "NETWORK_ERROR"
    );
  }

  const fetched = await Promise.all(
    revisions.map(async ({ ruleId, revisionId }) => ({
      ruleId,
      revisionId,
      ...(await fetchGenerated(context, ruleId)),
    }))
  );

  const ready: {
    served: ServedRule;
    prepared: PreparedRule;
    notices: string[];
  }[] = [];
  for (const { ruleId, revisionId, outcome, attempts } of fetched) {
    const served = servedOrThrow(context, ruleId, requestId, outcome, attempts);
    const verdict = await verifyServedRule(served, { ruleId, revisionId });
    if (!verdict.ok) {
      throw new CLIError(
        `The generated rule could not be delivered: ${verdict.reason}.`,
        "RULE_GENERATION_FAILED"
      );
    }
    // Held per rule and released in the write loop, so a rule's notices stay
    // together in the order the request listed the rules.
    const notices: string[] = [];
    const prepared = prepareOrThrow(cwd, verdict.fileSet, (message) => {
      notices.push(message);
    });
    ready.push({ served, prepared, notices });
  }

  const delivered: Delivered = { rules: [], files: [], notices: [] };
  for (const { served, prepared, notices } of ready) {
    delivered.notices.push(...notices);
    const ruleFile = await writePreparedRule(cwd, prepared, (message) => {
      delivered.notices.push(message);
    });
    delivered.rules.push(prepared.id);
    delivered.files.push(ruleFile);
    const planNotice = notRunOnPlanNotice(served, prepared.engine, ruleFile);
    if (planNotice !== undefined) delivered.notices.push(planNotice);
  }
  return delivered;
}

/**
 * {@link prepareServedRule}, with its refusals carrying a code.
 *
 * A refusal that is already a `CLIError` (an engine this CLI does not know,
 * `RULE_UNSUPPORTED`) keeps its own code. The rest are plain `Error`s, which
 * `rule restore` also receives and reports as it always has, so they are
 * wrapped here rather than at the source: a generated rule that cannot be
 * written is a `RULE_GENERATION_FAILED`, like one that fails verification.
 */
function prepareOrThrow(
  cwd: string,
  fileSet: ServedFileSet,
  onWarning: (message: string) => void
): PreparedRule {
  try {
    return prepareServedRule(cwd, fileSet, onWarning);
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      `The generated rule could not be delivered: ${error instanceof Error ? error.message : String(error)}`,
      "RULE_GENERATION_FAILED"
    );
  }
}

type FetchOutcome = Awaited<ReturnType<typeof fetchRule>>;

/**
 * Fetch a just-generated rule, retrying a retryable `unavailable` the way
 * polling does. The rule already exists by now, so giving up on a blip would
 * throw away a generation that succeeded. Never throws: the last outcome is
 * returned with the number of attempts it took, for `servedOrThrow` to judge.
 */
async function fetchGenerated(
  context: GenerationContext,
  ruleId: string
): Promise<{ outcome: FetchOutcome; attempts: number }> {
  for (let attempts = 1; ; attempts += 1) {
    const outcome = await fetchRule(context.token, ruleId, {
      repositoryUrl: context.repositoryUrl,
      ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
    });
    if (
      outcome.status !== "unavailable" ||
      !outcome.retryable ||
      attempts >= MAX_CONSECUTIVE_UNAVAILABLE
    ) {
      return { outcome, attempts };
    }
    context.onProgress(
      `Fetching rule ${ruleId} failed (${outcome.reason}); retrying (${String(attempts)}/${String(MAX_CONSECUTIVE_UNAVAILABLE - 1)})...`
    );
    await pause();
  }
}

function servedOrThrow(
  context: GenerationContext,
  ruleId: string,
  requestId: string,
  outcome: FetchOutcome,
  attempts: number
): ServedRule {
  switch (outcome.status) {
    case "ok": {
      return outcome.data;
    }
    case "refused": {
      // A head is served on every plan, so this means the service answered for
      // a revision the CLI did not ask for. Relay its message; it is the only
      // explanation available.
      throw new CLIError(
        `Rule ${ruleId} was generated but could not be fetched: ${describeRefusal(outcome.refusal)}`,
        "RULE_GENERATION_FAILED"
      );
    }
    case "error": {
      throw new CLIError(
        `Rule ${ruleId} was generated but could not be fetched (${outcome.code}).`,
        "RULE_GENERATION_FAILED"
      );
    }
    case "unauthorized": {
      throw new CLIError(
        `Rule ${ruleId} could not be fetched: authentication was rejected. ${rejectedTokenRemedy()}`,
        "AUTH_REQUIRED"
      );
    }
    case "unavailable": {
      // Nothing has been written: every rule is fetched before any is.
      throw new CLIError(
        `Rule ${ruleId} was generated by request ${requestId} but could not be fetched: ${outcome.reason}${attempts > 1 ? `, ${String(attempts)} times in a row` : ""}. No rules were written. Run \`${context.resumeCommand}\` to fetch it again without generating it again.`,
        "NETWORK_ERROR"
      );
    }
  }
}

/**
 * The warning for a runtime rule written under a plan that will not run it.
 *
 * The rule is still written: it is the organization's rule, and it runs the
 * moment the plan allows. What must not happen is the author finishing
 * `rule create` believing it is live. Static rules never warn.
 */
function notRunOnPlanNotice(
  served: ServedRule,
  engine: string,
  ruleFile: string
): string | undefined {
  if (engine !== "runtime") return undefined;
  const entitlement = parseEntitlementV2(served.entitlement);
  if (entitlement === undefined) return undefined;
  return `${ruleFile} was written. ${notRunOnPlanSentence(entitlement)}`;
}
