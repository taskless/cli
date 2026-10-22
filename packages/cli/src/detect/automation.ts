import { existsSync, globSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

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
 * Every CI and commit-time config file at `root`, as sorted root-relative
 * paths: the files the signals above match, with a directory signal expanded
 * to the files directly inside it (`.husky/pre-commit`, `.buildkite/pipeline.yml`).
 *
 * This is what runs commands on the repository's behalf, so it is where a
 * pinned Taskless invocation is left behind by an upgrade.
 */
export function automationFiles(root: string): string[] {
  const files = new Set<string>();
  for (const signal of [...CI_SIGNALS, ...HOOK_SIGNALS]) {
    for (const pattern of signal.paths ?? []) {
      if (!pattern.endsWith("/")) {
        for (const path of globSync(pattern, { cwd: root })) files.add(path);
        continue;
      }
      let entries;
      try {
        entries = readdirSync(resolve(root, pattern), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile()) files.add(`${pattern}${entry.name}`);
      }
    }
  }
  return [...files].toSorted();
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

/**
 * Keys whose values are commands, or name what a step runs, across the CI and
 * hook formats above: GitHub Actions `run`/`uses`, GitLab and Travis
 * `script`, CircleCI `run`/`command`, Buildkite and Drone `commands`, Azure
 * `bash`/`pwsh`, lefthook `run`, pre-commit `entry` and `repo`. Everything
 * beneath one is collected, so `run: { command }` and script arrays count.
 * Labels (`name`, `id`, `description`) are deliberately absent.
 */
const COMMAND_KEYS: ReadonlySet<string> = new Set([
  "run",
  "uses",
  "script",
  "before_script",
  "after_script",
  "before_install",
  "install",
  "command",
  "commands",
  "bash",
  "pwsh",
  "powershell",
  "sh",
  "entry",
  "repo",
]);

/** Configs whose every value is a command: lint-staged maps globs to them, simple-git-hooks maps hook names. */
function isCommandMap(file: string): boolean {
  return /^\.?(?:lintstagedrc|lint-staged|simple-git-hooks)/.test(
    basename(file)
  );
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

function collectCommands(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (COMMAND_KEYS.has(key)) collectStrings(item, into);
      else collectCommands(item, into);
    }
  }
}

/** A structured config parsed by its extension; `undefined` when it is not one, `null` when malformed. */
function parseStructured(file: string, raw: string): unknown {
  const extension = extname(file);
  try {
    if (extension === ".yml" || extension === ".yaml") return parseYaml(raw);
    if (extension === ".json") return JSON.parse(raw);
    if (extension === ".toml") return parseToml(raw);
  } catch {
    return null;
  }
  // `.lintstagedrc` with no extension is JSON or YAML, and YAML reads both.
  if (extension === "" && isCommandMap(file)) {
    try {
      return parseYaml(raw);
    } catch {
      return null;
    }
  }
  return undefined;
}

/**
 * A line of shell or JavaScript with its trailing comment removed. A comment
 * starts at a `#` or `//` that opens the line or follows whitespace, and only
 * outside a quoted string: `echo "a # b" && golangci-lint run` keeps its
 * invocation. Backslash escapes inside double quotes and backticks; single
 * quotes are literal, as in shell.
 */
function stripLineComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote !== undefined) {
      if (char === "\\" && quote !== "'") index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    const opensComment =
      char === "#" || (char === "/" && line[index + 1] === "/");
    if (opensComment && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }
  return line;
}

/**
 * The commands a CI or hook config runs, so a linter is evidenced by being
 * RUN rather than by being mentioned. A structured config contributes only
 * the values of its command keys; a step's name or a comment is not a
 * command. Anything else (a husky script, a Jenkinsfile, a JavaScript
 * config) is code, and contributes its lines with comments removed. A
 * malformed config contributes nothing.
 */
export function automationCommands(file: string, raw: string): string[] {
  const parsed = parseStructured(file, raw);
  if (parsed === null) return [];
  const commands: string[] = [];
  if (parsed === undefined) {
    for (const line of raw.split("\n")) {
      const code = stripLineComment(line).trim();
      if (code !== "") commands.push(code);
    }
  } else if (isCommandMap(file)) {
    collectStrings(parsed, commands);
  } else {
    collectCommands(parsed, commands);
  }
  return commands;
}
