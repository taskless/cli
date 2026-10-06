import {
  fetchRule,
  getRequestStatus,
  retryAdvice,
  type RequestStatus,
  type ServedRule,
} from "../api/v2";
import { notRunOnPlanSentence, parseEntitlementV2 } from "../api/entitlement";
import { describeRefusal, stripControlCharacters } from "../api/refusal";
import { CLIError } from "../util/cli-error";
import { getCliPrefix } from "../util/package-manager";
import { writeServedRule } from "./files";
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
}

const POLL_INTERVAL_MS = 15_000;

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
    `If access recently changed, re-authenticate with \`${getCliPrefix()} auth login\`.`,
  ];
}

/** A request's terminal status. */
export type FinishedRequest = RequestStatus;

/**
 * Poll a request until it stops moving.
 *
 * Throws a `CLIError` for anything that is not an answer about the request:
 * `request_not_found` (the id will never resolve, reported as `NETWORK_ERROR`
 * because the remedy is to resubmit), a rejected token, and an unreachable
 * service, each with the code a caller branches on.
 */
export async function awaitRequest(
  context: GenerationContext,
  requestId: string
): Promise<FinishedRequest> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const outcome = await getRequestStatus(context.token, requestId, {
      repositoryUrl: context.repositoryUrl,
      ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
    });
    switch (outcome.status) {
      case "ok": {
        break;
      }
      case "unauthorized": {
        throw new CLIError(
          "Polling failed: authentication was rejected. Log in again.",
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
        throw new CLIError(
          `Polling failed: ${outcome.reason}.${retryAdvice(outcome)}`,
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
 * Fetch, verify, then write every rule a request produced.
 *
 * All rules are fetched and verified before ANY is written, so a request whose
 * second rule fails verification leaves the tree exactly as it was rather than
 * holding half a delivery that already reported nothing.
 */
export async function deliverRevisions(
  cwd: string,
  context: GenerationContext,
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
      outcome: await fetchRule(context.token, ruleId, {
        repositoryUrl: context.repositoryUrl,
        ...(context.orgId === undefined ? {} : { orgId: context.orgId }),
      }),
    }))
  );

  const verified = [];
  for (const { ruleId, revisionId, outcome } of fetched) {
    const served = servedOrThrow(ruleId, outcome);
    const verdict = await verifyServedRule(served, { ruleId, revisionId });
    if (!verdict.ok) {
      throw new CLIError(
        `The generated rule could not be delivered: ${verdict.reason}.`,
        "RULE_GENERATION_FAILED"
      );
    }
    verified.push({ served, fileSet: verdict.fileSet });
  }

  const delivered: Delivered = { rules: [], files: [], notices: [] };
  for (const { served, fileSet } of verified) {
    const ruleFile = await writeServedRule(cwd, fileSet, (message) => {
      delivered.notices.push(message);
    });
    delivered.rules.push(fileSet.id);
    delivered.files.push(ruleFile);
    const planNotice = notRunOnPlanNotice(served, fileSet.engine, ruleFile);
    if (planNotice !== undefined) delivered.notices.push(planNotice);
  }
  return delivered;
}

function servedOrThrow(
  ruleId: string,
  outcome: Awaited<ReturnType<typeof fetchRule>>
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
        `Rule ${ruleId} could not be fetched: authentication was rejected. Log in again.`,
        "AUTH_REQUIRED"
      );
    }
    case "unavailable": {
      throw new CLIError(
        `Rule ${ruleId} could not be fetched: ${outcome.reason}.${retryAdvice(outcome)}`,
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
