import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { LANGUAGE_MARKERS } from "../detect/scan";
import { resolveRepositoryPath } from "./git-remote";

/**
 * The value a dimension carries when it cannot be resolved.
 *
 * A sentinel rather than an omitted property, matching `UNKNOWN_GH_OWNER`:
 * runs that cannot resolve a dimension stay countable instead of vanishing
 * from aggregates. Hashes are hex, so no real value can collide with it.
 */
export const UNKNOWN_DIMENSION = "[unknown]";

/** `ciProvider` when the run is not CI at all, as distinct from unrecognized. */
export const NO_CI_PROVIDER = "[none]";

/** Hex SHA-256. Shared so `workspaceId` and `repositoryId` cannot diverge. */
function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The absolute path of the workspace root: the git top-level when `cwd` is
 * inside a working tree, otherwise `cwd` resolved.
 *
 * Resolving upward is the entire reason this exists. `check` run from
 * `packages/cli` and `check` run from the repository root are the same
 * workspace, and they only report the same `workspaceId` if the path is taken
 * to the top level first. Anchoring on `cwd` would make every subdirectory its
 * own workspace and inflate the count without bound.
 *
 * Asks git rather than looking for a `.git` directory, for the reason
 * `isGitWorkTree` gives: a worktree, a submodule and a `GIT_DIR` override are
 * all real working trees with no `.git` directory at `cwd`.
 *
 * Never rejects.
 */
export function resolveWorkspaceRoot(cwd: string): Promise<string> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
      (error, stdout) => {
        const top = stdout.trim();
        resolvePromise(error || !top ? resolve(cwd) : resolve(top));
      }
    );
  });
}

/**
 * A stable identifier for the workspace, hashed.
 *
 * Hashing here is genuinely protective, unlike in `resolveRepositoryId` below:
 * a local absolute path commonly contains a username, and the space of local
 * paths is not enumerable, so the hash cannot be walked back to its input.
 *
 * Two clones of one repository report DIFFERENT values, which is correct —
 * they are two workspaces — while `repositoryId` reports the same for both.
 * That split is what lets "how many checkouts" and "how many codebases" be
 * counted separately.
 */
export async function resolveWorkspaceId(cwd: string): Promise<string> {
  return hashIdentity(await resolveWorkspaceRoot(cwd));
}

/**
 * A stable identifier for the repository, hashed, or `[unknown]`.
 *
 * The hash is NOT a secret and must not be described as one: a remote URL is
 * reversible by anyone who can enumerate candidate URLs. It is hashed because
 * a repository NAME can be an unannounced product, which is a different
 * question from confidentiality. `ghOwner` stays unhashed alongside it,
 * because an owner is public identity and the value is load-bearing precisely
 * when legible — excluding a known owner from external-adoption counts needs
 * the name. Owner legible, repository not.
 */
export async function resolveRepositoryId(cwd: string): Promise<string> {
  const path = await resolveRepositoryPath(cwd);
  return path ? hashIdentity(path) : UNKNOWN_DIMENSION;
}

/**
 * Whether `CI` holds a positive value.
 *
 * Unset, empty, `"0"` and `"false"` are false; any other non-empty value is
 * true. This is DELIBERATELY wider than `init.ts`'s interactivity check, which
 * accepts only `"true"`/`"1"`. The two answer different questions — one
 * decides whether to prompt a human, this one classifies a run for analytics —
 * and a provider exporting `CI=yes` should count as CI even where erring
 * toward prompting would be wrong. They are allowed to disagree.
 */
export function isContinuousIntegration(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  const value = environment.CI?.trim().toLowerCase();
  if (!value) return false;
  return value !== "0" && value !== "false";
}

/**
 * Environment variables that name a CI provider, most specific first.
 *
 * Ordered because providers nest: Codespaces and many self-hosted setups also
 * export `CI`, and GitHub Actions sets both `GITHUB_ACTIONS` and `CI`. The
 * first match wins, so a more specific marker is never shadowed by a generic
 * one.
 */
const CI_PROVIDERS: ReadonlyArray<{ variable: string; name: string }> = [
  { variable: "GITHUB_ACTIONS", name: "github_actions" },
  { variable: "GITLAB_CI", name: "gitlab_ci" },
  { variable: "CIRCLECI", name: "circleci" },
  { variable: "BUILDKITE", name: "buildkite" },
  { variable: "TRAVIS", name: "travis" },
  { variable: "APPVEYOR", name: "appveyor" },
  { variable: "DRONE", name: "drone" },
  { variable: "TEAMCITY_VERSION", name: "teamcity" },
  { variable: "BITBUCKET_BUILD_NUMBER", name: "bitbucket_pipelines" },
  { variable: "TF_BUILD", name: "azure_pipelines" },
  { variable: "CODEBUILD_BUILD_ID", name: "aws_codebuild" },
  { variable: "JENKINS_URL", name: "jenkins" },
  { variable: "WOODPECKER", name: "woodpecker" },
  { variable: "VERCEL", name: "vercel" },
  { variable: "NETLIFY", name: "netlify" },
];

/**
 * The detected CI provider, `[unknown]` on CI with no recognized marker, or
 * `[none]` off CI.
 *
 * Two sentinels rather than one, because collapsing them loses the ability to
 * tell "a provider we have not taught this list about" from "a laptop". The
 * first is a gap in the table worth closing; the second is the ordinary case
 * and needs no action.
 */
export function resolveCiProvider(
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (!isContinuousIntegration(environment)) return NO_CI_PROVIDER;
  const matched = CI_PROVIDERS.find(
    ({ variable }) => (environment[variable] ?? "").trim() !== ""
  );
  return matched ? matched.name : UNKNOWN_DIMENSION;
}

/**
 * Node's manifest, which `LANGUAGE_MARKERS` has no entry for.
 *
 * The detection scan derives JavaScript and TypeScript from `package.json`
 * dependencies rather than from a marker, so a probe built from the shared
 * constant alone reports NOTHING for the stack this CLI is most used on. Added
 * here rather than to `LANGUAGE_MARKERS` itself, since the scan already has a
 * richer answer for Node and would then have two.
 */
const NODE_MARKER = {
  language: "JavaScript/TypeScript",
  files: ["package.json"],
};

/**
 * The languages evidenced by manifest files AT THE WORKSPACE ROOT.
 *
 * Deliberately not `detectRepository`. That performs a recursive glob with
 * manifest parsing, which is fine for a command the user asked for and is not
 * fine on every invocation — including the `agent` fetches an agent makes
 * repeatedly. This is a bounded `existsSync` per marker.
 *
 * The mapping comes from the scan's own `LANGUAGE_MARKERS` so the two cannot
 * disagree about which manifest means which language; they differ only in
 * search scope. That difference has a real cost: a language confined to a
 * sub-package of a monorepo does not appear here. It is accepted, because this
 * is a coarse telemetry dimension rather than a detection result, and it is
 * the price of the property being free. Do not "fix" it by making this
 * recursive.
 */
export function resolveLanguageStack(workspaceRoot: string): string[] {
  const languages: string[] = [];
  for (const marker of [NODE_MARKER, ...LANGUAGE_MARKERS]) {
    if (marker.files.some((file) => existsSync(resolve(workspaceRoot, file)))) {
      languages.push(marker.language);
    }
  }
  return languages;
}

/** Every adoption dimension, resolved once per process by `getTelemetry`. */
export interface AdoptionDimensions {
  workspaceId: string;
  repositoryId: string;
  envOS: string;
  ci: boolean;
  ciProvider: string;
  languageStack: string[];
}

/**
 * Resolve all six dimensions.
 *
 * Never rejects: each dimension has a defined value for every failure of
 * resolution, so a capture never has to choose between omitting a property and
 * failing. Telemetry is not a precondition for any command.
 *
 * With no `cwd`, only the three dimensions that DEPEND on one fall back to
 * their sentinels, matching how `resolveScaffoldVersion` and `ghOwner` treat
 * the same case. `envOS`, `ci` and `ciProvider` are properties of the process
 * rather than of a directory, so they stay real — sentinelling them would
 * discard a known answer to look consistent.
 *
 * The earlier version defaulted to `process.cwd()` here, which contradicted
 * the comment at the call site claiming it behaved like its neighbours: it
 * resolved live git state instead. Unreachable today, since every call site
 * passes a `cwd`, and a trap for the next one that does not.
 */
export async function resolveAdoptionDimensions(
  cwd: string | undefined
): Promise<AdoptionDimensions> {
  const environment = {
    envOS: process.platform,
    ci: isContinuousIntegration(),
    ciProvider: resolveCiProvider(),
  };

  if (!cwd) {
    return {
      workspaceId: UNKNOWN_DIMENSION,
      repositoryId: UNKNOWN_DIMENSION,
      languageStack: [],
      ...environment,
    };
  }

  // Independent lookups, so they run concurrently: each spawns its own git
  // process and neither reads the other's answer. `languageStack` is the
  // exception and stays sequential — it probes the workspace root, so it
  // cannot start until that root is known.
  const [workspaceRoot, repositoryId] = await Promise.all([
    resolveWorkspaceRoot(cwd),
    resolveRepositoryId(cwd),
  ]);

  return {
    workspaceId: hashIdentity(workspaceRoot),
    repositoryId,
    languageStack: resolveLanguageStack(workspaceRoot),
    ...environment,
  };
}
