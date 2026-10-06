import { existsSync, globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Something that runs commands on the repository's behalf without anyone
 * typing them: a CI system, or a tool that runs at commit time. Same shape as a
 * detected linter, so a consumer handling one handles all three.
 */
export interface DetectedAutomation {
  /** Identifier, e.g. `github-actions` or `husky`. */
  name: string;
  /** What matched: a path relative to the scan root, or a `package.json` marker. */
  evidence: string[];
}

/**
 * Matched at the scan ROOT only, unlike linters. A CI system reads its config
 * from the repository root and git runs one set of hooks per repository, so a
 * `.gitlab-ci.yml` three directories down is a fixture or a vendored project,
 * not this repository's CI. The monorepo walk that is right for linter configs
 * would report it anyway.
 *
 * `paths` are globs relative to the root. A trailing `/` names a directory,
 * whose presence is the signal (`.husky/` holds the hook scripts themselves).
 */
interface AutomationSignal {
  name: string;
  paths?: string[];
  /** Root `package.json` dependency names. */
  deps?: string[];
  /** Root `package.json` top-level keys the tool reads its config from. */
  packageJsonKeys?: string[];
}

/** The file table the `ci` recipe uses, as root-relative globs. */
const CI_SIGNALS: readonly AutomationSignal[] = [
  {
    name: "github-actions",
    paths: [".github/workflows/*.yml", ".github/workflows/*.yaml"],
  },
  { name: "gitlab-ci", paths: [".gitlab-ci.yml"] },
  { name: "circleci", paths: [".circleci/config.yml"] },
  { name: "jenkins", paths: ["Jenkinsfile"] },
  {
    name: "azure-pipelines",
    paths: ["azure-pipelines.yml", "azure-pipelines.yaml"],
  },
  { name: "bitbucket-pipelines", paths: ["bitbucket-pipelines.yml"] },
  { name: "buildkite", paths: [".buildkite/"] },
  { name: "drone", paths: [".drone.yml"] },
  { name: "travis-ci", paths: [".travis.yml"] },
];

/**
 * Tools that run commands at commit time.
 *
 * lint-staged is not a hook manager; something else has to call it. It is
 * listed because it is what turns "run on commit" into "run on the staged
 * files", which is the question the onboard recipe asks, and leaving it out
 * would hide the most common way a repository already answers it.
 */
const HOOK_SIGNALS: readonly AutomationSignal[] = [
  { name: "husky", paths: [".husky/"], deps: ["husky"] },
  {
    name: "lefthook",
    paths: [
      "lefthook.yml",
      "lefthook.yaml",
      "lefthook.json",
      "lefthook.toml",
      ".lefthook.yml",
      ".lefthook.yaml",
      ".lefthook.json",
      ".lefthook.toml",
    ],
    deps: ["lefthook", "@evilmartians/lefthook"],
  },
  { name: "pre-commit", paths: [".pre-commit-config.yaml"] },
  {
    name: "simple-git-hooks",
    paths: [
      ".simple-git-hooks.json",
      ".simple-git-hooks.js",
      ".simple-git-hooks.cjs",
      ".simple-git-hooks.mjs",
      "simple-git-hooks.json",
      "simple-git-hooks.js",
      "simple-git-hooks.cjs",
      "simple-git-hooks.mjs",
    ],
    deps: ["simple-git-hooks"],
    packageJsonKeys: ["simple-git-hooks"],
  },
  {
    name: "lint-staged",
    paths: [
      ".lintstagedrc",
      ".lintstagedrc.json",
      ".lintstagedrc.yaml",
      ".lintstagedrc.yml",
      ".lintstagedrc.mjs",
      ".lintstagedrc.cjs",
      ".lintstagedrc.js",
      "lint-staged.config.mjs",
      "lint-staged.config.cjs",
      "lint-staged.config.js",
    ],
    deps: ["lint-staged"],
    packageJsonKeys: ["lint-staged"],
  },
];

interface RootPackageJson {
  keys: Set<string>;
  deps: Set<string>;
}

function objectKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

/** The root `package.json`'s keys and dependency names; empty when absent or malformed. */
async function readRootPackageJson(root: string): Promise<RootPackageJson> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  } catch {
    return { keys: new Set(), deps: new Set() };
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  return {
    keys: new Set(objectKeys(parsed)),
    deps: new Set([
      ...objectKeys(record.dependencies),
      ...objectKeys(record.devDependencies),
    ]),
  };
}

function matchSignals(
  root: string,
  signals: readonly AutomationSignal[],
  packageJson: RootPackageJson
): DetectedAutomation[] {
  const detected: DetectedAutomation[] = [];
  for (const signal of signals) {
    const evidence: string[] = [];
    for (const pattern of signal.paths ?? []) {
      if (pattern.endsWith("/")) {
        if (existsSync(resolve(root, pattern))) evidence.push(pattern);
      } else {
        evidence.push(...globSync(pattern, { cwd: root }).toSorted());
      }
    }
    for (const key of signal.packageJsonKeys ?? []) {
      if (packageJson.keys.has(key)) evidence.push(`package.json (${key})`);
    }
    for (const dep of signal.deps ?? []) {
      if (packageJson.deps.has(dep)) {
        evidence.push(`dependency ${dep} (package.json)`);
      }
    }
    if (evidence.length > 0) detected.push({ name: signal.name, evidence });
  }
  return detected;
}

/**
 * The CI systems and commit-time tools configured at `root`. Pure filesystem
 * reads; an unreadable or malformed `package.json` contributes nothing rather
 * than failing the scan.
 */
export async function detectAutomation(
  root: string
): Promise<{ ci: DetectedAutomation[]; hooks: DetectedAutomation[] }> {
  const packageJson = await readRootPackageJson(root);
  return {
    ci: matchSignals(root, CI_SIGNALS, packageJson),
    hooks: matchSignals(root, HOOK_SIGNALS, packageJson),
  };
}
