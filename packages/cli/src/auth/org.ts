import type { WhoamiResult } from "../api/v2";
import { decodeOrgId, NIL_ORG_ID } from "./jwt";
import { fetchWhoami } from "./whoami";
import { listRemoteOwnerUrls } from "../util/git-remote";

type WhoamiData = WhoamiResult;

/**
 * One organization from `GET /cli/api/v2/whoami`. Adapts the generated OpenAPI
 * shape to what the CLI actually acts on, staying forward-compatible with the
 * server's coming identity cleanup:
 *
 * - `id` — the canonical, stable, platform-agnostic Taskless org id and the
 *   only subject the CLI acts on. A UUID string, so kept as the generated
 *   `string` (the `string | number` tolerance lives on the legacy JWT-claim
 *   path in `decodeOrgId`, where a numeric id can still appear).
 * - `githubOrgId` — GitHub's numeric org id, a convenience only. The server is
 *   renaming the legacy `orgId` to this; read `githubOrgId ?? orgId` so either
 *   spelling resolves during the transition.
 * - `installationId` is intentionally dropped — the CLI never uses it and it
 *   should not be sent to us.
 *
 * `url` is the canonical OWNER url (e.g. `https://github.com/acme`) matched
 * against the repo's remotes.
 */
export type WhoamiOrg = Omit<
  WhoamiData["orgs"][number],
  "orgId" | "installationId"
> & {
  orgId?: number;
  githubOrgId?: number;
};

/**
 * Pick the acting org from a whoami org list given the repo's owner urls (in
 * `origin` → `upstream` → rest precedence). Exact `url` equality against
 * GitHub-sourced orgs; the first remote that matches an org wins. Returns
 * `undefined` when nothing matches (no current-org context).
 */
export function selectOrgForOwners(
  ownerUrls: string[],
  orgs: WhoamiOrg[]
): WhoamiOrg | undefined {
  const byUrl = new Map(
    orgs.filter((org) => org.source === "github").map((org) => [org.url, org])
  );
  for (const ownerUrl of ownerUrls) {
    const org = byUrl.get(ownerUrl);
    if (org) return org;
  }
  return undefined;
}

/**
 * Resolve which org the CLI acts as for the repo at `cwd`: match the repo's
 * local git remotes against `orgs[].url`. Returns `undefined` when there is no
 * GitHub remote or no org owns it — the caller then has no current-org context
 * (and any write it attempts is authorized, and may be denied, server-side).
 */
export async function resolveCurrentOrg(
  cwd: string,
  orgs: WhoamiOrg[]
): Promise<WhoamiOrg | undefined> {
  const ownerUrls = await listRemoteOwnerUrls(cwd);
  return selectOrgForOwners(ownerUrls, orgs);
}

/**
 * The org subject to send on write calls. Prefers the current org's Taskless
 * UUID (`id`), resolved by matching the repo's remotes against `whoami`; falls
 * back to the token's canonical id (or its deprecated numeric `orgId` claim)
 * when whoami is unavailable or no org owns the repo. A new client thus routes
 * multi-org users correctly, while older single-org behaviour is preserved via
 * the claim.
 *
 * Never `undefined`: when neither a matched org nor a token claim resolves,
 * returns the nil-UUID `NIL_ORG_ID` so the canonical subject is always known
 * (unattributed usage is sent under one stable, known org id).
 */
export async function resolveOrgSubject(
  cwd: string,
  token: string
): Promise<string | number> {
  const whoami = await fetchWhoami(token);
  if (whoami && whoami.orgs.length > 0) {
    const org = await resolveCurrentOrg(cwd, whoami.orgs);
    if (org) return org.id;
  }
  return decodeOrgId(token) ?? NIL_ORG_ID;
}
