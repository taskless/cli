import { getToken } from "./token";
import { resolveOrgSubject } from "./org";
import { CLIError } from "../util/cli-error";
import { resolveRepositoryUrl } from "../util/git-remote";
import { getCliPrefix } from "../util/package-manager";
import type { CLIErrorCode } from "../types/errors";

export interface Identity {
  token: string;
  /**
   * Org subject to send on write calls: the current org's Taskless UUID
   * (preferred) or the deprecated numeric `orgId` claim. See `resolveOrgSubject`.
   */
  orgSubject: string | number;
  repositoryUrl: string;
}

/**
 * Resolve the current user's identity for a write call.
 * - orgSubject: the current org's Taskless UUID matched from `whoami` + the
 *   repo's remotes, falling back to the token's canonical id claim, and finally
 *   to the nil-UUID `NIL_ORG_ID` so a subject is always present
 * - repositoryUrl: inferred from `git remote get-url origin`
 *
 * Throws a `CLIError` carrying a stable `CLIErrorCode` if auth is missing
 * (`AUTH_REQUIRED`) or the repository URL cannot be resolved, in which case
 * the code names which population the project is in:
 * `NOT_A_GIT_REPOSITORY`, `NO_ORIGIN_REMOTE`, or `UNSUPPORTED_REMOTE_HOST`.
 * Read the code off the error with `identityFailureCode`; never re-derive it
 * from the message.
 */
export async function resolveIdentity(cwd: string): Promise<Identity> {
  const token = await getToken(cwd);
  if (!token) {
    throw new CLIError(
      `Authentication required. Run \`${getCliPrefix()} auth login\` to authenticate.`,
      "AUTH_REQUIRED"
    );
  }

  const repositoryUrl = await resolveRepositoryUrl(cwd);
  const orgSubject = await resolveOrgSubject(cwd, token);

  return { token, orgSubject, repositoryUrl };
}

/**
 * The stable error code for a `resolveIdentity` failure.
 *
 * Every expected failure inside `resolveIdentity` throws a `CLIError` that
 * already carries its code, so this reads a field rather than matching on
 * prose. It is shared by every caller so the mapping cannot drift between
 * them.
 *
 * `resolveOrgSubject` is deliberately absent from the list of expected
 * failures: it cannot throw. `fetchWhoami` swallows every network and HTTP
 * error and returns `undefined`, and `decodeOrgId` falls back to the nil-UUID
 * `NIL_ORG_ID`, so a repo with no matching org resolves a subject rather than
 * failing. Anything that does escape it is a bug in the CLI, not a state the
 * caller can act on, so it reports as `INTERNAL_ERROR`.
 */
export function identityFailureCode(error: unknown): CLIErrorCode {
  if (error instanceof CLIError && error.code) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}
