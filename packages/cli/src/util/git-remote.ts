import { execFile } from "node:child_process";

import { CLIError } from "./cli-error";

/**
 * Resolve the repository URL from `git remote get-url origin`,
 * canonicalized to `https://github.com/{owner}/{repo}`.
 *
 * Both failure modes (no readable `origin`, and an `origin` that is not on
 * github.com) throw a `CLIError` carrying `NO_GITHUB_REMOTE`. The code travels
 * with the failure so a caller reads a field instead of matching on the
 * message: rewording either string must never change what a `--json` consumer
 * is told.
 */
export async function resolveRepositoryUrl(cwd: string): Promise<string> {
  const rawUrl = await getOriginUrl(cwd);
  return canonicalizeGitHubUrl(rawUrl);
}

function getOriginUrl(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd },
      (error, stdout) => {
        if (error) {
          reject(
            new CLIError(
              "Could not determine repository URL from git remote. Ensure your repository has an 'origin' remote pointing to GitHub.",
              "NO_GITHUB_REMOTE"
            )
          );
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
    `Unsupported git remote URL: "${rawUrl}". Only GitHub repositories (github.com) are supported.`,
    "NO_GITHUB_REMOTE"
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
