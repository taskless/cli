import { parseUpgradeUrl } from "./entitlement";

/**
 * A plan refusal from a v2 recovery route: restore, rollback, or fetching a
 * revision other than a rule's head.
 *
 * The service answers these with a `200`, not an error, because the request
 * was understood and the rule exists (a nonexistent rule is still a `404`).
 * The plan simply does not include recovering it, and `message` says how to
 * recover it from git instead. That makes a refusal an answer to relay, never
 * a service failure to report: calling it "unavailable" would send the user to
 * retry something that will be refused identically every time.
 */
export interface Refusal {
  /** The machine-readable cause, e.g. `RESTORE_RULES_NOT_IN_PLAN`. */
  reason: string;
  /** Server-authored guidance, already stripped of control characters. */
  message: string;
  /** Present only when it parsed as an absolute `https:` URL. */
  upgradeUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Remove C0 and C1 control characters, and DEL, except newline.
 *
 * `message` is written by the service to be printed verbatim, and it is
 * printed to a terminal. A terminal interprets an escape sequence rather than
 * showing it, so bytes from across the network could move the cursor, rewrite
 * lines already printed, or retitle the window. The service has no reason to
 * send any of that, which is why removing it loses nothing.
 */
export function stripControlCharacters(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replaceAll(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "");
}

/**
 * Read a refusal from an untrusted response body.
 *
 * Returns `undefined` unless `restoreRules` is exactly `false`, which is the
 * discriminator the service documents. A refusal whose `reason` the CLI does
 * not recognize is still a refusal: the service answered, and relaying its
 * message is right whatever the code says. A refusal missing its `message`
 * gets a generic one rather than being dropped, for the same reason.
 */
export function parseRefusal(value: unknown): Refusal | undefined {
  if (!isRecord(value) || value.restoreRules !== false) return undefined;

  const reason =
    typeof value.reason === "string" && value.reason !== ""
      ? value.reason
      : "UNSPECIFIED";
  const message =
    typeof value.message === "string" && value.message.trim() !== ""
      ? stripControlCharacters(value.message)
      : `The rule service declined this request for your organization's plan (${reason}).`;
  const upgradeUrl = parseUpgradeUrl(value.upgradeUrl);

  return {
    reason,
    message,
    ...(upgradeUrl === undefined ? {} : { upgradeUrl }),
  };
}
