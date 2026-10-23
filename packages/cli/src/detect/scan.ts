import { existsSync, globSync } from "node:fs";
import { readFile as readFileNode } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { RULES_DIRECTORY } from "../rules/layout";
import {
  automationCommands,
  automationFiles,
  detectAutomation,
  type DetectedAutomation,
} from "./automation";
import { countCustomRules, type CustomRules } from "./custom-rules";

export interface DetectedLinter {
  name: string;
  /**
   * On-disk evidence for this linter: a config-file path, a manifest table or
   * INI section marker, a dependency marker from the language's package file,
   * or a root CI or hook config that runs it. Each
   * entry carries the path it was found at, so monorepo evidence
   * (`packages/api/.eslintrc.json`) is attributable. Not all entries are file
   * paths.
   */
  evidence: string[];
  /**
   * Rules the repository wrote itself for this linter, for the linters that
   * can hold one. Absent for every other linter.
   */
  customRules?: CustomRules;
}

export interface RuleStyle {
  source: string;
  description: string;
}

export interface DetectResult {
  linters: DetectedLinter[];
  languages: string[];
  ruleStyles: RuleStyle[];
  /** CI systems configured at the scan root. */
  ci: DetectedAutomation[];
  /** Tools that run commands at commit time, configured at the scan root. */
  hooks: DetectedAutomation[];
}

/**
 * Directory names pruned from the repo walk. Held as a curated list so the scan
 * never descends into dependency trees, build output, or VCS metadata — the
 * places a real linter config never lives and where traversal cost explodes.
 * Recursive `fs.glob` does not honor `.gitignore`, so we prune explicitly; an
 * explicit list is also more deterministic than whatever each repo ignores.
 */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".gradle",
  // Taskless's own state. It holds an `sgconfig.yml` and a `.vale.ini` that
  // Taskless writes for itself, which are not the repository's linters: an
  // unpruned walk reports every installed repository as already running
  // ast-grep and Vale.
  ".taskless",
]);

/**
 * Maximum directory depth (levels below the scan root) the walk descends.
 * Bounds traversal on pathological trees; monorepo manifests live well within
 * this — root → workspace group → package → nested package is four.
 */
const MAX_DIRECTORY_DEPTH = 8;

/**
 * A linter is curated, deterministic signal — never inference. detect never
 * matches a request against a catalog of packaged rules; that judgment lives in
 * the `existing` recipe.
 *
 * Each linter is tagged with the language(s) it serves so dependency evidence
 * is read from the right package file: a node dependency lives in
 * `package.json`, a Python dependency in `pyproject.toml`/`requirements*.txt`,
 * a Ruby one in `Gemfile`, a PHP one in `composer.json`, a Go one in `go.mod`,
 * a Swift one in `Package.swift`. Tagging by language lets the scan look for a
 * linter's dependency only in its own ecosystem's manifest instead of
 * conflating them. Config-file presence
 * is honored unconditionally, per the detect spec ("a recognized linter config
 * ... SHALL report each configured linter it found"), so a lone `.eslintrc.json`
 * still detects eslint.
 */
interface LinterSignal {
  name: string;
  /** Languages this linter serves; a detected linter contributes these. */
  languages: string[];
  /** Fixed config filenames; presence on disk is direct evidence. */
  configFiles?: string[];
  /**
   * Dotted TOML tables in a manifest the linter reads its config from, e.g.
   * `tool.ruff` in `pyproject.toml` or `lints.clippy` in `Cargo.toml`.
   */
  manifestTables?: Array<{ manifest: TomlManifest; table: string }>;
  /** `[section]` headers in an INI file the linter reads, e.g. `[flake8]` in `setup.cfg`. */
  iniSections?: Array<{ file: string; section: string }>;
  /** Top-level `package.json` keys the linter reads its config from. */
  packageJsonKeys?: string[];
  /**
   * Dependency names, matched against the manifests of this linter's
   * languages. A Go module matches by path prefix, so the `/v2` and `/cmd/...`
   * forms of a module count; a Swift package is its lowercased repository path.
   */
  deps?: string[];
  /**
   * Commands that run this linter, matched against the commands the root CI
   * and commit-hook configs run (`automationCommands`), never their comments
   * or step names. This is the only evidence for a linter that runs on its defaults
   * and is not a dependency, such as clippy, which ships with the toolchain.
   */
  invocations?: RegExp[];
}

/** TOML manifests parsed for `manifestTables`. */
type TomlManifest = "pyproject.toml" | "Cargo.toml";

const LINTER_SIGNALS: readonly LinterSignal[] = [
  {
    name: "eslint",
    languages: ["JavaScript", "TypeScript"],
    configFiles: [
      ".eslintrc",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.mjs",
      ".eslintrc.json",
      ".eslintrc.yml",
      ".eslintrc.yaml",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      "eslint.config.mts",
      "eslint.config.cts",
    ],
    packageJsonKeys: ["eslintConfig"],
    deps: ["eslint"],
  },
  {
    name: "biome",
    languages: ["JavaScript", "TypeScript"],
    configFiles: ["biome.json", "biome.jsonc"],
    deps: ["@biomejs/biome"],
  },
  {
    name: "oxlint",
    languages: ["JavaScript", "TypeScript"],
    // The four names oxlint discovers on its own (oxc.rs, "Configuration").
    // `oxlint.config.{js,mjs,cjs}` are accepted only via `-c`, never found by
    // the walk, so listing them would be dead weight in the sweep.
    configFiles: [
      ".oxlintrc.json",
      ".oxlintrc.jsonc",
      "oxlint.config.ts",
      "oxlint.config.mts",
    ],
    deps: ["oxlint"],
  },
  {
    name: "stylelint",
    languages: ["JavaScript", "TypeScript"],
    // cosmiconfig's default search places for `stylelint` (cosmiconfig 9).
    configFiles: [
      ".stylelintrc",
      ".stylelintrc.js",
      ".stylelintrc.cjs",
      ".stylelintrc.mjs",
      ".stylelintrc.ts",
      ".stylelintrc.json",
      ".stylelintrc.yml",
      ".stylelintrc.yaml",
      "stylelint.config.js",
      "stylelint.config.cjs",
      "stylelint.config.mjs",
      "stylelint.config.ts",
    ],
    packageJsonKeys: ["stylelint"],
    deps: ["stylelint"],
  },
  {
    name: "prettier",
    languages: ["JavaScript", "TypeScript"],
    configFiles: [
      ".prettierrc",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.ts",
      ".prettierrc.mts",
      ".prettierrc.cts",
      ".prettierrc.json",
      ".prettierrc.json5",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
      "prettier.config.ts",
      "prettier.config.mts",
      "prettier.config.cts",
    ],
    packageJsonKeys: ["prettier"],
    deps: ["prettier"],
  },
  {
    name: "ruff",
    languages: ["Python"],
    configFiles: ["ruff.toml", ".ruff.toml"],
    manifestTables: [{ manifest: "pyproject.toml", table: "tool.ruff" }],
    deps: ["ruff"],
    invocations: [
      /\bruff\s+(?:check|format)\b/,
      /\bastral-sh\/ruff-(?:pre-commit|action)\b/,
    ],
  },
  {
    name: "flake8",
    languages: ["Python"],
    configFiles: [".flake8"],
    // flake8 does not read `pyproject.toml`, so this is where its config
    // usually lives.
    iniSections: [
      { file: "setup.cfg", section: "flake8" },
      { file: "tox.ini", section: "flake8" },
    ],
    deps: ["flake8"],
    invocations: [/\bflake8\b/],
  },
  {
    name: "pylint",
    languages: ["Python"],
    configFiles: [".pylintrc", "pylintrc"],
    manifestTables: [{ manifest: "pyproject.toml", table: "tool.pylint" }],
    deps: ["pylint"],
    invocations: [/\bpylint\b/],
  },
  {
    name: "black",
    languages: ["Python"],
    manifestTables: [{ manifest: "pyproject.toml", table: "tool.black" }],
    deps: ["black"],
    invocations: [/\bblack\s+--check\b/, /\bpsf\/black\b/],
  },
  {
    name: "rubocop",
    languages: ["Ruby"],
    configFiles: [".rubocop.yml", ".rubocop.yaml"],
    deps: ["rubocop"],
    invocations: [/\brubocop\b/],
  },
  {
    name: "standard",
    languages: ["Ruby"],
    configFiles: [".standard.yml"],
    deps: ["standard"],
    invocations: [/\bstandardrb\b/],
  },
  {
    name: "golangci-lint",
    languages: ["Go"],
    configFiles: [
      ".golangci.yml",
      ".golangci.yaml",
      ".golangci.toml",
      ".golangci.json",
    ],
    // A `tool` directive (Go 1.24+) or the older tools.go `require`.
    deps: ["github.com/golangci/golangci-lint"],
    invocations: [/\bgolangci-lint\b/],
  },
  {
    // Ships with rustup, so it is never a dependency, and most repositories
    // run it with no config file. Being a Rust repository is NOT evidence:
    // clippy counts only when it is configured or something runs it.
    name: "clippy",
    languages: ["Rust"],
    configFiles: ["clippy.toml", ".clippy.toml"],
    manifestTables: [
      { manifest: "Cargo.toml", table: "lints.clippy" },
      { manifest: "Cargo.toml", table: "workspace.lints.clippy" },
    ],
    invocations: [/\bcargo\s+(?:\+\S+\s+)?clippy\b/],
  },
  {
    name: "phpstan",
    languages: ["PHP"],
    configFiles: ["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"],
    deps: ["phpstan/phpstan"],
    invocations: [/\bphpstan\b/],
  },
  {
    name: "php_codesniffer",
    languages: ["PHP"],
    configFiles: [
      "phpcs.xml",
      "phpcs.xml.dist",
      ".phpcs.xml",
      ".phpcs.xml.dist",
    ],
    deps: ["squizlabs/php_codesniffer"],
    invocations: [/\bphpcs\b/],
  },
  {
    name: "psalm",
    languages: ["PHP"],
    configFiles: ["psalm.xml", "psalm.xml.dist"],
    deps: ["vimeo/psalm"],
    invocations: [/\bvendor\/bin\/psalm\b/],
  },
  {
    name: "pint",
    languages: ["PHP"],
    configFiles: ["pint.json"],
    deps: ["laravel/pint"],
    invocations: [/\bvendor\/bin\/pint\b/],
  },
  {
    name: "php-cs-fixer",
    languages: ["PHP"],
    configFiles: [".php-cs-fixer.php", ".php-cs-fixer.dist.php"],
    deps: ["friendsofphp/php-cs-fixer"],
    invocations: [/\bphp-cs-fixer\b/],
  },
  {
    name: "clang-tidy",
    languages: ["C", "C++"],
    configFiles: [".clang-tidy"],
    invocations: [/\bclang-tidy\b/],
  },
  {
    name: "swiftlint",
    languages: ["Swift"],
    configFiles: [".swiftlint.yml", ".swiftlint.yaml"],
    // The SwiftPM plugin, from either of its two published repositories.
    deps: [
      "github.com/realm/swiftlint",
      "github.com/simplydanny/swiftlintplugins",
    ],
    invocations: [/\bswiftlint\b/],
  },
  { name: "checkstyle", languages: ["Java"], configFiles: ["checkstyle.xml"] },
  // Polyglot and prose linters: neither says anything about which languages
  // the repository is written in, so they contribute none.
  {
    name: "ast-grep",
    languages: [],
    configFiles: ["sgconfig.yml", ".sgconfig.yml"],
  },
  { name: "vale", languages: [], configFiles: [".vale.ini", "_vale.ini"] },
];

/**
 * Languages inferred from the presence of a manifest or marker file anywhere in
 * the tree. JavaScript and TypeScript are resolved separately (they share
 * `package.json`).
 *
 * Exported so telemetry's root-only `languageStack` probe reads the same
 * language-to-manifest mapping this scan does. The two differ only in search
 * scope: this walks the tree, the probe checks the workspace root. Sharing the
 * mapping keeps them from disagreeing about which manifest means which
 * language; the scope difference is deliberate and documented there. Note the
 * probe adds its own Node entry, since the JavaScript/TypeScript resolution
 * mentioned above happens outside this constant.
 */
export const LANGUAGE_MARKERS: ReadonlyArray<{
  language: string;
  files: string[];
}> = [
  {
    language: "Python",
    files: [
      "pyproject.toml",
      "requirements.txt",
      "setup.cfg",
      "setup.py",
      "Pipfile",
    ],
  },
  { language: "Ruby", files: ["Gemfile"] },
  { language: "Go", files: ["go.mod"] },
  { language: "Rust", files: ["Cargo.toml"] },
  { language: "PHP", files: ["composer.json"] },
  { language: "Java", files: ["pom.xml", "build.gradle", "build.gradle.kts"] },
  { language: "Swift", files: ["Package.swift"] },
];

/** Every basename the walk needs to find, deduped for a single glob pass. */
const DISCOVERABLE_FILES: readonly string[] = [
  ...new Set<string>([
    "package.json",
    "tsconfig.json",
    ...LANGUAGE_MARKERS.flatMap((marker) => marker.files),
    ...LINTER_SIGNALS.flatMap((signal) => [
      ...(signal.configFiles ?? []),
      ...(signal.iniSections ?? []).map((ini) => ini.file),
    ]),
  ]),
];

/**
 * pip requirements files beyond the bare `requirements.txt` marker: the
 * `requirements-dev.txt` / `dev-requirements.txt` split, a `requirements/`
 * directory of them, and pip-tools `.in` sources. Dev tools such as linters
 * live in exactly these.
 */
const REQUIREMENTS_PATTERNS: readonly string[] = [
  "**/*requirements*.{txt,in}",
  "**/requirements/*.{txt,in}",
];

async function readFileSafe(path: string): Promise<string | undefined> {
  try {
    return await readFileNode(path, "utf8");
  } catch {
    return undefined;
  }
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Object keys, but only for a plain object (a malformed manifest field that
 * is an array, string, or null contributes no dependency names). */
function plainObjectKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

/** Collect all declared dependency names from a parsed package.json. */
function nodeDependencyNames(packageJson: PackageJson): Set<string> {
  return new Set([
    ...plainObjectKeys(packageJson.dependencies),
    ...plainObjectKeys(packageJson.devDependencies),
    ...plainObjectKeys(packageJson.peerDependencies),
  ]);
}

/**
 * Parse a TOML manifest (`pyproject.toml`, `Cargo.toml`) with a real TOML
 * parser. A malformed file yields `undefined` rather than throwing — detect
 * degrades gracefully, losing only the manifest-derived signals (the file's
 * mere presence still marks the language, and config files like `ruff.toml`
 * are independent tells).
 */
function parseTomlManifest(
  raw: string | undefined
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    return parseToml(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Whether a parsed TOML manifest declares the dotted `table` (or a nested table
 * under it: `tool.ruff` matches `[tool.ruff.lint]`). A real parser makes this
 * exact: a similarly-named sibling like `[tool.ruff-lsp]` is a distinct key and
 * does not match.
 */
function hasTomlTable(
  manifest: Record<string, unknown> | undefined,
  table: string
): boolean {
  let node: Record<string, unknown> | undefined = manifest;
  for (const key of table.split(".")) {
    if (node === undefined || !Object.hasOwn(node, key)) return false;
    node = asRecord(node[key]);
  }
  return node !== undefined;
}

/** Whether an INI file (`setup.cfg`, `tox.ini`) has a `[section]` header. */
function hasIniSection(raw: string | undefined, section: string): boolean {
  if (raw === undefined) return false;
  return raw
    .split("\n")
    .some((line) => line.trim().toLowerCase() === `[${section}]`);
}

/** Strip a PEP 508 requirement string down to its package name. */
function requirementName(requirement: string): string {
  return requirement
    .trim()
    .split(/[\s<>=!~;[\],()]/)[0]!
    .toLowerCase();
}

/** Package names from an array of PEP 508 requirement strings. Non-string
 * entries (a PEP 735 `{ include-group = "..." }`) and non-arrays contribute
 * nothing. */
function requirementNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => requirementName(entry));
}

/** Package names from a table of named groups, each an array of PEP 508
 * requirement strings (`optional-dependencies`, PEP 735 `dependency-groups`,
 * PDM's `dev-dependencies`). */
function groupedRequirementNames(value: unknown): string[] {
  return Object.values(asRecord(value) ?? {}).flatMap((group) =>
    requirementNames(group)
  );
}

/**
 * Python dependency names declared in a parsed `pyproject.toml`.
 *
 * A dev tool like ruff is rarely a runtime dependency, so the dev-dependency
 * locations matter as much as `[project]`: PEP 735 `[dependency-groups]` (what
 * `uv add --dev` writes), uv's legacy `[tool.uv] dev-dependencies`, PDM's and
 * Hatch's own tables, and Poetry's groups. A repository that installs ruff
 * through any of these and runs it on its defaults has no `[tool.ruff]` table,
 * so this is the only evidence it lints.
 */
function pythonDepsFromPyproject(
  pyproject: Record<string, unknown> | undefined
): string[] {
  if (pyproject === undefined) return [];
  const names: string[] = [];

  const project = asRecord(pyproject.project);
  names.push(
    ...requirementNames(project?.dependencies),
    ...groupedRequirementNames(project?.["optional-dependencies"]),
    ...groupedRequirementNames(pyproject["dependency-groups"])
  );

  const tool = asRecord(pyproject.tool);
  names.push(
    ...requirementNames(asRecord(tool?.uv)?.["dev-dependencies"]),
    ...groupedRequirementNames(asRecord(tool?.pdm)?.["dev-dependencies"])
  );
  for (const environment of Object.values(
    asRecord(asRecord(tool?.hatch)?.envs) ?? {}
  )) {
    const table = asRecord(environment);
    names.push(
      ...requirementNames(table?.dependencies),
      ...requirementNames(table?.["extra-dependencies"])
    );
  }

  // Poetry keys dependencies by name. Groups nest one level deeper, under
  // `[tool.poetry.group.<name>.dependencies]`.
  const poetry = asRecord(tool?.poetry);
  const poetryTables = [
    poetry?.dependencies,
    poetry?.["dev-dependencies"],
    ...Object.values(asRecord(poetry?.group) ?? {}).map(
      (group) => asRecord(group)?.dependencies
    ),
  ];
  for (const table of poetryTables) {
    names.push(
      ...Object.keys(asRecord(table) ?? {}).map((name) => name.toLowerCase())
    );
  }

  return names;
}

/** Gem names declared in a `Gemfile` (`gem "rubocop", require: false`). */
function rubyDepsFromGemfile(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return [...raw.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((match) =>
    match[1]!.toLowerCase()
  );
}

/** Package names in a `composer.json`'s `require` and `require-dev`. */
function phpDepsFromComposer(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const composer = asRecord(parsed);
  return [
    ...plainObjectKeys(composer?.require),
    ...plainObjectKeys(composer?.["require-dev"]),
  ].map((name) => name.toLowerCase());
}

/**
 * Module paths named in a `go.mod`'s `require` and `tool` directives, single
 * or block form, with every `/`-prefix of each, so a signal's
 * `github.com/golangci/golangci-lint` matches the
 * `github.com/golangci/golangci-lint/v2/cmd/golangci-lint` a tool line names.
 */
function goDepsFromGoModule(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const paths: string[] = [];
  let block: string | undefined;
  for (const line of raw.split("\n")) {
    const tokens = line
      .replace(/\/\/.*$/, "")
      .trim()
      .split(/\s+/);
    if (tokens[0] === ")") {
      block = undefined;
      continue;
    }
    let path: string | undefined;
    if (tokens[0] === "require" || tokens[0] === "tool") {
      if (tokens[1] === "(") block = tokens[0];
      else path = tokens[1];
    } else if (block !== undefined) {
      path = tokens[0];
    }
    if (path === undefined || !path.includes("/")) continue;
    const segments = path.split("/");
    for (let index = 2; index <= segments.length; index++) {
      paths.push(segments.slice(0, index).join("/"));
    }
  }
  return paths;
}

/**
 * Repository paths of the packages a `Package.swift` depends on, lowercased
 * and normalized from URL or SSH form (`github.com/realm/swiftlint`).
 */
function swiftDepsFromPackageSwift(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return [...raw.matchAll(/\.package\(\s*url:\s*"([^"]+)"/g)].map((match) =>
    match[1]!
      .toLowerCase()
      .replace(/^[a-z+]+:\/\//, "")
      .replace(/^git@([^:]+):/, "$1/")
      .replace(/\.git$/, "")
      .replace(/\/$/, "")
  );
}

/** Python dependency names declared in a `requirements.txt`. */
function pythonDepsFromRequirements(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const names: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("-")) {
      continue;
    }
    names.push(requirementName(trimmed));
  }
  return names;
}

/** The basename (last path segment) of a `/`-or-`\`-separated relative path. */
function basenameOf(relativePath: string): string {
  return relativePath.split(/[/\\]/).at(-1) ?? "";
}

/**
 * Prune the walk: skip the curated ignore directories and anything past the
 * depth cap. `fs.glob` calls this on each candidate as it descends, so a `true`
 * here stops traversal into that directory.
 */
function shouldExclude(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]/);
  if (segments.length > MAX_DIRECTORY_DEPTH) return true;
  return IGNORED_DIRECTORIES.has(segments.at(-1) ?? "");
}

/** A package file and the dependency names it declares. */
interface Manifest {
  path: string;
  deps: Set<string>;
}

interface NodeManifest extends Manifest {
  /** Top-level keys, for linters configured inside `package.json`. */
  keys: Set<string>;
}

/**
 * Surface the styles of the repo's own existing rules so the authoring recipe
 * can match house conventions. ast-grep rules are the repo-root, polyglot
 * Taskless convention, so they are read at the scan root — from the `sg` engine
 * directory, or the pre-migration `.taskless/rules` when that is what the repo
 * still has; the custom-ESLint-rule tells (house rule directories and the
 * local-rules plugin dependency) describe how this repo already authors lint
 * rules.
 */
function detectRuleStyles(
  root: string,
  nodeManifests: NodeManifest[]
): RuleStyle[] {
  const ruleStyles: RuleStyle[] = [];
  for (const source of [`.taskless/${RULES_DIRECTORY}/sg`]) {
    if (!existsSync(resolve(root, source))) continue;
    ruleStyles.push({
      source,
      description:
        "Existing Taskless ast-grep rules — match their structure and conventions.",
    });
    break;
  }
  for (const directory of [
    "eslint-rules",
    "eslint-local-rules",
    "tools/eslint-rules",
  ]) {
    if (existsSync(resolve(root, directory))) {
      ruleStyles.push({
        source: directory,
        description:
          "Custom ESLint rules — follow the house style when authoring new ones.",
      });
    }
  }
  const localRulesManifest = nodeManifests.find(
    (manifest) =>
      manifest.deps.has("eslint-plugin-local") ||
      manifest.deps.has("eslint-local-rules")
  );
  if (localRulesManifest) {
    ruleStyles.push({
      source: localRulesManifest.path,
      description:
        "Local ESLint rule plugin in use — author new rules to match it.",
    });
  }
  return ruleStyles;
}

/**
 * Deterministically scan `cwd` for the languages present, the linters
 * configured for those languages, and the repo's own rule styles. Pure
 * filesystem reads — no network, no auth, no LLM. Unreadable or malformed files
 * are skipped rather than failing the scan.
 *
 * The scan is monorepo-aware: a single bounded `fs.glob` walk (curated ignore
 * list + depth cap) finds manifests and configs anywhere in the tree, so a
 * linter configured in a sub-package is detected with its path as evidence. The
 * flow is languages → linters: a linter's dependency is looked up only in its
 * own language's manifests. CI systems and commit-time tools are the exception
 * to the walk, read at the root only (see `./automation`).
 */
export async function detectRepository(cwd: string): Promise<DetectResult> {
  const root = resolve(cwd);

  const foundPaths = globSync(`**/{${DISCOVERABLE_FILES.join(",")}}`, {
    cwd: root,
    exclude: shouldExclude,
  });
  const requirementsPaths = [
    ...new Set(
      globSync([...REQUIREMENTS_PATTERNS], {
        cwd: root,
        exclude: shouldExclude,
      })
    ),
  ];

  const pathsByBasename = new Map<string, string[]>();
  for (const relativePath of foundPaths) {
    const basename = basenameOf(relativePath);
    const list = pathsByBasename.get(basename);
    if (list) list.push(relativePath);
    else pathsByBasename.set(basename, [relativePath]);
  }
  const pathsFor = (basename: string): string[] =>
    pathsByBasename.get(basename) ?? [];
  const readAt = (relativePath: string): Promise<string | undefined> =>
    readFileSafe(resolve(root, relativePath));

  // Node manifests → JS/TS dependency names, per location.
  const nodeManifests: NodeManifest[] = [];
  for (const relativePath of pathsFor("package.json")) {
    const raw = await readAt(relativePath);
    if (raw === undefined) continue;
    let parsed: PackageJson;
    try {
      parsed = JSON.parse(raw) as PackageJson;
    } catch {
      continue;
    }
    nodeManifests.push({
      path: relativePath,
      deps: nodeDependencyNames(parsed),
      keys: new Set(plainObjectKeys(parsed)),
    });
  }

  // TOML manifests, parsed once: Python dependencies and `manifestTables`
  // both read them.
  const tomlManifests = new Map<
    TomlManifest,
    Array<{ path: string; parsed?: Record<string, unknown> }>
  >();
  for (const manifest of ["pyproject.toml", "Cargo.toml"] as const) {
    const parsedManifests = [];
    for (const relativePath of pathsFor(manifest)) {
      parsedManifests.push({
        path: relativePath,
        parsed: parseTomlManifest(await readAt(relativePath)),
      });
    }
    tomlManifests.set(manifest, parsedManifests);
  }

  // Python manifests → Python dependency names, per location.
  const pythonManifests: Manifest[] = (
    tomlManifests.get("pyproject.toml") ?? []
  ).map(({ path, parsed }) => ({
    path,
    deps: new Set(pythonDepsFromPyproject(parsed)),
  }));
  for (const relativePath of requirementsPaths) {
    pythonManifests.push({
      path: relativePath,
      deps: new Set(pythonDepsFromRequirements(await readAt(relativePath))),
    });
  }

  // The other ecosystems' manifests, one reader each.
  const manifestsFrom = async (
    basename: string,
    read: (raw: string | undefined) => string[]
  ): Promise<Manifest[]> => {
    const manifests: Manifest[] = [];
    for (const relativePath of pathsFor(basename)) {
      manifests.push({
        path: relativePath,
        deps: new Set(read(await readAt(relativePath))),
      });
    }
    return manifests;
  };
  const manifestsByLanguage = new Map<string, Manifest[]>([
    ["JavaScript", nodeManifests],
    ["TypeScript", nodeManifests],
    ["Python", pythonManifests],
    ["Ruby", await manifestsFrom("Gemfile", rubyDepsFromGemfile)],
    ["PHP", await manifestsFrom("composer.json", phpDepsFromComposer)],
    ["Go", await manifestsFrom("go.mod", goDepsFromGoModule)],
    ["Swift", await manifestsFrom("Package.swift", swiftDepsFromPackageSwift)],
  ]);

  // The commands the root CI and hook configs run, read once for every
  // signal's `invocations`.
  const automation: Array<{ path: string; commands: string[] }> = [];
  for (const relativePath of automationFiles(root)) {
    const raw = await readAt(relativePath);
    if (raw !== undefined) {
      automation.push({
        path: relativePath,
        commands: automationCommands(relativePath, raw),
      });
    }
  }

  // Languages: manifest/marker files first, then JS/TS from node manifests.
  const languages = new Set<string>();
  if (
    pathsFor("package.json").length > 0 ||
    pathsFor("tsconfig.json").length > 0
  ) {
    languages.add("JavaScript");
  }
  if (
    pathsFor("tsconfig.json").length > 0 ||
    nodeManifests.some((manifest) => manifest.deps.has("typescript"))
  ) {
    languages.add("TypeScript");
  }
  for (const marker of LANGUAGE_MARKERS) {
    if (marker.files.some((file) => pathsFor(file).length > 0)) {
      languages.add(marker.language);
    }
  }
  // Any pip requirements file marks Python, not only the bare
  // `requirements.txt` marker: a repository may keep only
  // `requirements-dev.txt` or a `requirements/` directory.
  if (requirementsPaths.length > 0) languages.add("Python");

  // Linters: config files unconditionally; dependency evidence from the
  // manifests of the linter's own languages; invocations from the root CI and
  // hook configs. A detected linter contributes its language(s).
  const linters: DetectedLinter[] = [];
  for (const signal of LINTER_SIGNALS) {
    const evidence: string[] = [];

    for (const configFile of signal.configFiles ?? []) {
      evidence.push(...pathsFor(configFile));
    }
    for (const { manifest, table } of signal.manifestTables ?? []) {
      for (const { path, parsed } of tomlManifests.get(manifest) ?? []) {
        if (hasTomlTable(parsed, table)) evidence.push(`${path} [${table}]`);
      }
    }
    for (const { file, section } of signal.iniSections ?? []) {
      for (const relativePath of pathsFor(file)) {
        if (hasIniSection(await readAt(relativePath), section)) {
          evidence.push(`${relativePath} [${section}]`);
        }
      }
    }
    for (const key of signal.packageJsonKeys ?? []) {
      for (const manifest of nodeManifests) {
        if (manifest.keys.has(key)) evidence.push(`${manifest.path} (${key})`);
      }
    }
    // JavaScript and TypeScript share `package.json`; read it once.
    const manifests = new Set(
      signal.languages.flatMap(
        (language) => manifestsByLanguage.get(language) ?? []
      )
    );
    for (const dep of signal.deps ?? []) {
      for (const manifest of manifests) {
        if (manifest.deps.has(dep)) {
          evidence.push(`dependency ${dep} (${manifest.path})`);
        }
      }
    }
    for (const { path, commands } of automation) {
      const match = (signal.invocations ?? [])
        .flatMap((pattern) => commands.map((command) => pattern.exec(command)))
        .find((result) => result !== null);
      if (match) evidence.push(`${path} (${match[0]})`);
    }

    if (evidence.length > 0) {
      const customRules = await countCustomRules(signal.name, {
        root,
        pathsFor,
        pyprojects: tomlManifests.get("pyproject.toml") ?? [],
        nodeDeps: nodeManifests,
      });
      linters.push({
        name: signal.name,
        evidence,
        ...(customRules && { customRules }),
      });
      for (const language of signal.languages) languages.add(language);
    }
  }

  return {
    linters,
    languages: [...languages],
    ruleStyles: detectRuleStyles(root, nodeManifests),
    ...(await detectAutomation(root)),
  };
}
