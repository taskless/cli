import type { V2Outcome, WhoamiResult } from "../api/v2";
import { isEnvironmentToken, rejectedTokenRemedy } from "./token";

/**
 * The lines `taskless auth` prints for a token, given the service's answer
 * about it.
 *
 * A rejected token and an unreachable service read differently on purpose: the
 * first names its fix, the second says nothing about the token, which may be
 * fine.
 */
export function describeAuthStatus(
  outcome: V2Outcome<WhoamiResult, never>
): string[] {
  const source = isEnvironmentToken() ? " via TASKLESS_TOKEN" : "";
  switch (outcome.status) {
    case "ok": {
      const orgs = outcome.data.orgs.map((o) => o.name);
      const orgSuffix = orgs.length > 0 ? ` (${orgs.join(", ")})` : "";
      return [`Logged in as ${outcome.data.user}${orgSuffix}${source}.`];
    }
    case "unauthorized": {
      return [
        `Logged in${source}, but the token was rejected.`,
        `It is invalid or expired. ${rejectedTokenRemedy()}`,
      ];
    }
    case "unavailable": {
      return [
        `Logged in${source}, but unable to verify identity.`,
        `The Taskless service was unreachable (${outcome.reason}).`,
      ];
    }
    default: {
      return [`Logged in${source}, but unable to verify identity.`];
    }
  }
}
