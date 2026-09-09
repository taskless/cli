import { execFile } from "node:child_process";

import { CLIError } from "./cli-error";

/**
 * Resolve the repository URL from `git remote get-url origin`,
 * canonicalized to `https://github.com/{owner}/{repo}`.
 *
 * Failure names WHICH of three populations the project is in, because the
 * remedies differ and an agent has to pick one: `NOT_A_GIT_REPOSITORY`,
 * `NO_ORIGIN_REMOTE`, or `UNSUPPORTED_REMOTE_HOST`. The code travels with
 * the failure so a caller reads a field instead of matching on the message:
 * rewording any of these strings must never change what a `--json` consumer
 * is told.
 *
 * All three are a capability boundary on REMOTE rule generation, not a
 * verdict on the repository. Local authoring, `verify`, `test` and `check`
 * work in every one of them, which is why each message names the local path
 * rather than only reporting the refusal.
 */
export async function resolveRepositoryUrl(cwd: string): Promise<string> {
  const rawUrl = await getOriginUrl(cwd);
  return canonicalizeGitHubUrl(rawUrl);
}

/**
 * Whether `cwd` sits inside a git working tree.
 *
 * Runs ONLY on the failure path. `git remote get-url origin` fails
 * identically for "not a repository" and "repository with no origin", so the
 * two are indistinguishable without asking a second question — and they are
 * the two whose remedies differ most (`git init` versus adding a remote).
 * Keeping the probe behind the failure means the ordinary case still spawns
 * one process, not two.
 *
 * Asks git rather than looking for a `.git` directory: a worktree, a
 * submodule and a `GIT_DIR` override are all real working trees without one
 * at `cwd`.
 */
function isGitWorkTree(cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd },
      (error, stdout) => {
        resolve(!error && stdout.trim() === "true");
      }
    );
  });
}

/**
 * The value `ghOwner` carries when no GitHub owner can be resolved.
 *
 * A sentinel rather than `null` or an omitted field, so runs with no
 * resolvable owner stay countable in analytics instead of vanishing from
 * aggregates. It cannot collide with a real owner: GitHub owner names admit
 * only alphanumerics and hyphens, so none can be spelled `[unknown]`.
 */
export const UNKNOWN_GH_OWNER = "[unknown]";

/**
 * The repository URL and GitHub owner, resolved without throwing.
 *
 * This NEVER rejects. Every reason an owner might not resolve is an ordinary
 * state rather than an error: the three no-remote populations, and the case
 * where git itself is not installed or not on `PATH`, which is none of them.
 * A caller reporting capability state or recording telemetry wants a value,
 * not an exception, and neither should fail because a lookup could not run.
 *
 * The single resolution behind both `info` and telemetry, deliberately. The
 * check that decides whether remote generation is OFFERED and the value that
 * is REPORTED must agree, and they can only be guaranteed to agree by coming
 * from the same place.
 */
export async function resolveRepositoryContext(
  cwd: string
): Promise<{ repositoryUrl: string | null; ghOwner: string }> {
  try {
    const repositoryUrl = await resolveRepositoryUrl(cwd);
    // `resolveRepositoryUrl` returns the canonical
    // `https://github.com/{owner}/{repo}`, so the owner is positional.
    const owner = repositoryUrl.split("/")[3];
    return owner
      ? { repositoryUrl, ghOwner: owner }
      : { repositoryUrl, ghOwner: UNKNOWN_GH_OWNER };
  } catch {
    return { repositoryUrl: null, ghOwner: UNKNOWN_GH_OWNER };
  }
}

function getOriginUrl(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd },
      (error, stdout) => {
        if (error) {
          void isGitWorkTree(cwd).then((inRepository) => {
            reject(
              inRepository
                ? new CLIError(
                    "Remote rule generation needs a GitHub `origin` remote, and this repository has none. Local rule authoring, `verify`, `test` and `check` work without one.",
                    "NO_ORIGIN_REMOTE"
                  )
                : new CLIError(
                    "Remote rule generation needs a GitHub repository, and this directory is not a git repository. Local rule authoring, `verify`, `test` and `check` work without one.",
                    "NOT_A_GIT_REPOSITORY"
                  )
            );
          });
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

// git@github.com:owner/repo.git or git@github.com:owner/repo
const SSH_PATTERN = /^git@github\.com:(?<path>[^/]+\/[^/]+?)(?:\.git)?$/;
// https://github.com/owner/repo.git or https://github.com/owner/repo
const HTTPS_PATTERN =
  /^https:\/\/github\.com\/(?<path>[^/]+\/[^/]+?)(?:\.git)?$/;

/** @internal Exported for testing only */
export function canonicalizeGitHubUrl(rawUrl: string): string {
  const sshMatch = SSH_PATTERN.exec(rawUrl);
  if (sshMatch?.groups?.path) {
    return `https://github.com/${sshMatch.groups.path}`;
  }

  const httpsMatch = HTTPS_PATTERN.exec(rawUrl);
  if (httpsMatch?.groups?.path) {
    return `https://github.com/${httpsMatch.groups.path}`;
  }

  throw new CLIError(
    `Remote rule generation supports GitHub only, and this repository's \`origin\` is "${rawUrl}". Local rule authoring, \`verify\`, \`test\` and \`check\` work with any remote or none.`,
    "UNSUPPORTED_REMOTE_HOST"
  );
}

/**
 * Reduce a git remote reference to a canonical OWNER url —
 * `https://{host}/{owner}`. This is a verbatim port of the server's
 * `@taskless/shared/github` `canonicalOwnerUrl`, which builds `whoami`'s
 * per-org `url`. The two sides are compared with `===`, so this MUST stay
 * byte-for-byte identical — any divergence silently drops an org match.
 *
 * Accepts a bare owner login, a full repo URL, or an SSH remote (scp-like or
 * `ssh://`/`git://` URL form). Host and owner are lowercased (GitHub logins are
 * case-insensitive), `www.` is stripped, a trailing `.git`/slash removed, and
 * userinfo, port, query, and fragment discarded. Host defaults to `github.com`
 * when the input carries none. Never throws: a non-GitHub host comes back as
 * `https://{that-host}/{owner}`, which simply won't match a GitHub org url —
 * `listRemoteOwnerUrls` is where non-GitHub owners are dropped.
 */
export function canonicalOwnerUrl(ownerOrUrl: string): string {
  const raw = ownerOrUrl.trim();
  let host = "github.com";
  let path = raw;

  const sshRemote = /^[^@/]+@([^:/]+):(.+)$/.exec(raw);
  if (sshRemote) {
    // scp-like SSH remote: git@github.com:owner/repo(.git)
    host = sshRemote[1] ?? host;
    path = sshRemote[2] ?? path;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//")) {
    // Absolute (https://, ssh://, git://) or scheme-relative (//host/...) URL
    try {
      const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      host = url.hostname;
      path = url.pathname;
    } catch {
      // Not parseable as a URL — fall through and treat the input as a path.
    }
  }

  host = host.toLowerCase().replace(/^www\./, "");
  const owner = (path.replace(/^\/+/, "").split("/")[0] ?? "")
    .replace(/\.git$/i, "")
    .toLowerCase();

  return `https://${host}/${owner}`;
}

/** A canonical owner url on github.com with a non-empty owner segment. */
const GITHUB_OWNER_URL = /^https:\/\/github\.com\/[^/]+$/;

/** Read every `remote.<name>.url` from git config; empty if not a repo / no remotes. */
function listRemoteConfig(
  cwd: string
): Promise<{ name: string; url: string }[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["config", "--get-regexp", String.raw`^remote\..*\.url$`],
      { cwd },
      (error, stdout) => {
        if (error) {
          resolve([]); // not a repo, no remotes, or git unavailable → no context
          return;
        }
        const remotes: { name: string; url: string }[] = [];
        for (const line of stdout.split("\n")) {
          // `remote.<name>.url <url>` — name may contain dots, so match greedily
          // up to the final `.url` before the value.
          const match = /^remote\.(?<name>.+)\.url\s+(?<url>.+)$/.exec(
            line.trim()
          );
          if (match?.groups?.name && match.groups.url) {
            remotes.push({ name: match.groups.name, url: match.groups.url });
          }
        }
        resolve(remotes);
      }
    );
  });
}

/** Remotes we trust most, in order, before falling back to config order. */
const REMOTE_PRECEDENCE = ["origin", "upstream"];

/**
 * The repo's canonical OWNER urls, ordered `origin` → `upstream` → remaining
 * remotes in config order, de-duplicated. Non-GitHub remotes are skipped. Used
 * to pick the acting org by matching against `whoami` `orgs[].url`.
 */
export async function listRemoteOwnerUrls(cwd: string): Promise<string[]> {
  const remotes = await listRemoteConfig(cwd);
  const ordered = [
    // A remote can carry several `remote.<name>.url` entries (e.g. `git remote
    // set-url --add`), so collect ALL of a precedence remote's urls, not just
    // the first — otherwise a second origin/upstream url is dropped entirely.
    ...REMOTE_PRECEDENCE.flatMap((name) =>
      remotes.filter((remote) => remote.name === name)
    ),
    ...remotes.filter((remote) => !REMOTE_PRECEDENCE.includes(remote.name)),
  ];

  const owners: string[] = [];
  const seen = new Set<string>();
  for (const remote of ordered) {
    const owner = canonicalOwnerUrl(remote.url);
    // Only a github.com owner can match a `github`-sourced whoami org. Drop
    // other hosts and any empty owner (a remote with no owner segment).
    if (!GITHUB_OWNER_URL.test(owner)) {
      continue;
    }
    if (!seen.has(owner)) {
      seen.add(owner);
      owners.push(owner);
    }
  }
  return owners;
}

/**
 * Reduce a git remote reference to a canonical REPOSITORY path,
 * `{host}/{owner}/{repo}`, or `null` when it carries no owner/repo pair.
 *
 * Host-agnostic, unlike `canonicalizeGitHubUrl` above. That function throws
 * `UNSUPPORTED_REMOTE_HOST` for a non-GitHub remote, and the refusal is
 * load-bearing: it is the capability boundary on REMOTE rule generation. This
 * answers a different question, "which codebase is this", which a GitLab,
 * Bitbucket or self-hosted repository participates in exactly as much as a
 * GitHub one. Teaching the GitHub parser to accept other hosts would have
 * softened a refusal doing real work elsewhere, so the two sit side by side.
 *
 * Parsing follows `canonicalOwnerUrl` — scp-like SSH, `ssh://`, `git://`,
 * `https://`, scheme-relative and bare paths — differing only in taking two
 * path segments rather than one. Host, owner and repository are lowercased:
 * GitHub treats all three case-insensitively, so `Foo/Bar` and `foo/bar` are
 * one repository and must not become two identities.
 *
 * Never throws. A remote it cannot parse yields `null`, which the caller turns
 * into the `[unknown]` sentinel.
 */
export function canonicalRepositoryPath(remote: string): string | null {
  const raw = remote.trim();
  if (!raw) return null;

  let host = "github.com";
  let path = raw;

  const sshRemote = /^[^@/]+@([^:/]+):(.+)$/.exec(raw);
  if (sshRemote) {
    host = sshRemote[1] ?? host;
    path = sshRemote[2] ?? path;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//")) {
    try {
      const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      host = url.hostname;
      path = url.pathname;
    } catch {
      // Not parseable as a URL — treat the input as a path, as
      // `canonicalOwnerUrl` does for the same inputs.
    }
  }

  host = host.toLowerCase().replace(/^www\./, "");
  const segments = path
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;

  // The repository is the LAST segment and the owner the FIRST. A self-hosted
  // GitLab serves repositories under nested subgroups, and anything between
  // the two is part of the address rather than the identity: keeping it would
  // make one repository read as several the moment a group were renamed.
  const owner = segments[0]!.toLowerCase();
  const repository = segments
    .at(-1)!
    .replace(/\.git$/i, "")
    .toLowerCase();
  if (!owner || !repository) return null;

  return `${host}/${owner}/${repository}`;
}

/**
 * The canonical repository path for `cwd`'s `origin` remote, or `null`.
 *
 * Reads `origin` alone rather than walking the `REMOTE_PRECEDENCE` fallback
 * `listRemoteOwnerUrls` uses. A repository identity has to be the SAME value
 * for every clone of one codebase, and precedence makes it depend on which
 * remotes a given clone happens to have configured: a fork with `origin` on
 * the fork and `upstream` on the source would report whichever the ordering
 * picked, so two clones of the same fork could disagree.
 *
 * Never throws. Not a repository, no `origin`, an unparseable remote, and git
 * missing from the host all yield `null`.
 */
export async function resolveRepositoryPath(
  cwd: string
): Promise<string | null> {
  const remotes = await listRemoteConfig(cwd);
  const origin = remotes.find((remote) => remote.name === "origin");
  return origin ? canonicalRepositoryPath(origin.url) : null;
}
