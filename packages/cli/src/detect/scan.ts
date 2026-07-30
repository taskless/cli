import { existsSync, globSync } from "node:fs";
import { readFile as readFileNode } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { ENGINE_LAYOUTS, LEGACY_RULES_DIRECTORY } from "../rules/engines";

export interface DetectedLinter {
  name: string;
  /**
   * On-disk evidence for this linter: a config-file path, a `pyproject.toml`
   * table marker, or a dependency marker from the language's package file. Each
   * entry carries the path it was found at, so monorepo evidence
   * (`packages/api/.eslintrc.json`) is attributable. Not all entries are file
   * paths.
   */
  evidence: string[];
}

export interface RuleStyle {
  source: string;
  description: string;
}

export interface DetectResult {
  linters: DetectedLinter[];
  languages: string[];
  ruleStyles: RuleStyle[];
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
 * `package.json`, a Python dependency in `pyproject.toml`/`requirements.txt`.
 * Tagging by language lets the scan look for a linter's dependency only in its
 * own ecosystem's manifest instead of conflating the two. Config-file presence
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
  /** `[tool.<x>]` tables in `pyproject.toml` (Python linters). */
  pyprojectTables?: string[];
  /** Dependency names, matched against the manifest of this linter's language. */
  deps?: string[];
}

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
    ],
    deps: ["eslint"],
  },
  {
    name: "biome",
    languages: ["JavaScript", "TypeScript"],
    configFiles: ["biome.json", "biome.jsonc"],
    deps: ["@biomejs/biome"],
  },
  {
    name: "stylelint",
    languages: ["JavaScript", "TypeScript"],
    configFiles: [
      ".stylelintrc",
      ".stylelintrc.js",
      ".stylelintrc.cjs",
      ".stylelintrc.json",
      ".stylelintrc.yml",
      ".stylelintrc.yaml",
      "stylelint.config.js",
      "stylelint.config.cjs",
      "stylelint.config.mjs",
    ],
    deps: ["stylelint"],
  },
  {
    name: "prettier",
    languages: ["JavaScript", "TypeScript"],
    configFiles: [
      ".prettierrc",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    ],
    deps: ["prettier"],
  },
  {
    name: "ruff",
    languages: ["Python"],
    configFiles: ["ruff.toml", ".ruff.toml"],
    pyprojectTables: ["ruff"],
    deps: ["ruff"],
  },
  {
    name: "flake8",
    languages: ["Python"],
    configFiles: [".flake8"],
    deps: ["flake8"],
  },
  {
    name: "pylint",
    languages: ["Python"],
    configFiles: [".pylintrc", "pylintrc"],
    pyprojectTables: ["pylint"],
    deps: ["pylint"],
  },
  {
    name: "black",
    languages: ["Python"],
    pyprojectTables: ["black"],
    deps: ["black"],
  },
  {
    name: "rubocop",
    languages: ["Ruby"],
    configFiles: [".rubocop.yml", ".rubocop.yaml"],
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
  },
  {
    name: "clippy",
    languages: ["Rust"],
    configFiles: ["clippy.toml", ".clippy.toml"],
  },
  {
    name: "phpstan",
    languages: ["PHP"],
    configFiles: ["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"],
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
  },
  {
    name: "psalm",
    languages: ["PHP"],
    configFiles: ["psalm.xml", "psalm.xml.dist"],
  },
  { name: "clang-tidy", languages: ["C", "C++"], configFiles: [".clang-tidy"] },
  {
    name: "swiftlint",
    languages: ["Swift"],
    configFiles: [".swiftlint.yml", ".swiftlint.yaml"],
  },
  { name: "checkstyle", languages: ["Java"], configFiles: ["checkstyle.xml"] },
];

/**
 * Languages inferred from the presence of a manifest or marker file anywhere in
 * the tree. JavaScript and TypeScript are resolved separately (they share
 * `package.json`).
 */
const LANGUAGE_MARKERS: ReadonlyArray<{ language: string; files: string[] }> = [
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
    ...LINTER_SIGNALS.flatMap((signal) => signal.configFiles ?? []),
  ]),
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
  eslintConfig?: unknown;
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
 * Parse `pyproject.toml` with a real TOML parser. A malformed file yields
 * `undefined` rather than throwing — detect degrades gracefully, losing only
 * the pyproject-derived signals (the file's mere presence still marks Python,
 * and config files like `ruff.toml` are independent tells).
 */
function parsePyproject(
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
 * Whether a parsed `pyproject.toml` declares a `[tool.<table>]` table (or a
 * nested table under it, e.g. `[tool.ruff.lint]`). A real parser makes this
 * exact: a similarly-named sibling like `[tool.ruff-lsp]` is a distinct key and
 * does not match.
 */
function pyprojectHasTable(
  pyproject: Record<string, unknown> | undefined,
  table: string
): boolean {
  const tool = asRecord(pyproject?.tool);
  return tool !== undefined && Object.hasOwn(tool, table);
}

/** Strip a PEP 508 requirement string down to its package name. */
function requirementName(requirement: string): string {
  return requirement
    .trim()
    .split(/[\s<>=!~;[\],()]/)[0]!
    .toLowerCase();
}

/** Python dependency names declared in a parsed `pyproject.toml` (PEP 621 + Poetry). */
function pythonDepsFromPyproject(
  pyproject: Record<string, unknown> | undefined
): string[] {
  if (pyproject === undefined) return [];
  const names: string[] = [];

  const project = asRecord(pyproject.project);
  const projectDeps = project?.dependencies;
  if (Array.isArray(projectDeps)) {
    for (const entry of projectDeps) {
      if (typeof entry === "string") names.push(requirementName(entry));
    }
  }
  const optional = asRecord(project?.["optional-dependencies"]);
  for (const group of Object.values(optional ?? {})) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      if (typeof entry === "string") names.push(requirementName(entry));
    }
  }

  const poetry = asRecord(asRecord(pyproject.tool)?.poetry);
  for (const key of ["dependencies", "dev-dependencies", "group"]) {
    const table = asRecord(poetry?.[key]);
    if (table) {
      names.push(...Object.keys(table).map((name) => name.toLowerCase()));
    }
  }

  return names;
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

interface NodeManifest {
  path: string;
  deps: Set<string>;
  hasEslintConfigKey: boolean;
}

interface PythonManifest {
  path: string;
  parsed?: Record<string, unknown>;
  deps: Set<string>;
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
  for (const source of [
    `.taskless/${ENGINE_LAYOUTS.sg.rulesDirectory}`,
    `.taskless/${LEGACY_RULES_DIRECTORY}`,
  ]) {
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
 * own language's manifests.
 */
export async function detectRepository(cwd: string): Promise<DetectResult> {
  const root = resolve(cwd);

  const foundPaths = globSync(`**/{${DISCOVERABLE_FILES.join(",")}}`, {
    cwd: root,
    exclude: shouldExclude,
  });

  const pathsByBasename = new Map<string, string[]>();
  for (const relativePath of foundPaths) {
    const basename = basenameOf(relativePath);
    const list = pathsByBasename.get(basename);
    if (list) list.push(relativePath);
    else pathsByBasename.set(basename, [relativePath]);
  }
  const pathsFor = (basename: string): string[] =>
    pathsByBasename.get(basename) ?? [];

  // Node manifests → JS/TS dependency names, per location.
  const nodeManifests: NodeManifest[] = [];
  for (const relativePath of pathsFor("package.json")) {
    const raw = await readFileSafe(resolve(root, relativePath));
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
      hasEslintConfigKey: parsed.eslintConfig !== undefined,
    });
  }

  // Python manifests → Python dependency names, per location.
  const pythonManifests: PythonManifest[] = [];
  for (const relativePath of pathsFor("pyproject.toml")) {
    const parsed = parsePyproject(
      await readFileSafe(resolve(root, relativePath))
    );
    pythonManifests.push({
      path: relativePath,
      parsed,
      deps: new Set(pythonDepsFromPyproject(parsed)),
    });
  }
  for (const relativePath of pathsFor("requirements.txt")) {
    pythonManifests.push({
      path: relativePath,
      deps: new Set(
        pythonDepsFromRequirements(
          await readFileSafe(resolve(root, relativePath))
        )
      ),
    });
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

  // Linters: config files unconditionally; dependency evidence from the
  // manifests of the linter's own language. A detected linter contributes its
  // language(s).
  const linters: DetectedLinter[] = [];
  for (const signal of LINTER_SIGNALS) {
    const evidence: string[] = [];
    const servesPython = signal.languages.includes("Python");
    const servesNode =
      signal.languages.includes("JavaScript") ||
      signal.languages.includes("TypeScript");

    for (const configFile of signal.configFiles ?? []) {
      evidence.push(...pathsFor(configFile));
    }
    for (const table of signal.pyprojectTables ?? []) {
      for (const manifest of pythonManifests) {
        if (pyprojectHasTable(manifest.parsed, table)) {
          evidence.push(`${manifest.path} [tool.${table}]`);
        }
      }
    }
    for (const dep of signal.deps ?? []) {
      const manifests = servesPython
        ? pythonManifests
        : servesNode
          ? nodeManifests
          : [];
      for (const manifest of manifests) {
        if (manifest.deps.has(dep)) {
          evidence.push(`dependency ${dep} (${manifest.path})`);
        }
      }
    }
    if (signal.name === "eslint") {
      for (const manifest of nodeManifests) {
        if (manifest.hasEslintConfigKey) {
          evidence.push(`${manifest.path} (eslintConfig)`);
        }
      }
    }

    if (evidence.length > 0) {
      linters.push({ name: signal.name, evidence });
      for (const language of signal.languages) languages.add(language);
    }
  }

  return {
    linters,
    languages: [...languages],
    ruleStyles: detectRuleStyles(root, nodeManifests),
  };
}
