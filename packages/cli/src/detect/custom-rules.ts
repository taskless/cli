import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * How many rules the repository wrote itself for one linter, and where they
 * were found. The legacy ladder reads this to decide whether an agent may write
 * another custom rule, which it may only do with five or more examples to model
 * it on.
 *
 * `"unknown"` means a custom rule exists but its count cannot be read without
 * executing configuration (an ESLint plugin imported into a JavaScript config).
 * Recipes treat it as below the threshold, which sends the request to a
 * Taskless rule, the safe direction.
 */
export interface CustomRules {
  count: number | "unknown";
  evidence: string[];
}

/** What the scan already found, so this module reads nothing twice. */
export interface CustomRuleContext {
  root: string;
  pathsFor: (basename: string) => string[];
  pyprojects: Array<{ path: string; parsed?: Record<string, unknown> }>;
  nodeDeps: Array<{ path: string; deps: Set<string> }>;
}

export async function countCustomRules(
  linter: string,
  context: CustomRuleContext
): Promise<CustomRules | undefined> {
  switch (linter) {
    case "eslint": {
      return countEslint(context);
    }
    case "biome": {
      return countBiome(context);
    }
    case "pylint": {
      return countPylint(context);
    }
    case "flake8": {
      return countFlake8(context);
    }
    // Ruff has no custom-rule mechanism. A fixed zero rather than nothing,
    // because an absent count would read as "not checked".
    case "ruff": {
      return { count: 0, evidence: [] };
    }
    default: {
      return undefined;
    }
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
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

// --- ESLint ------------------------------------------------------------------

/**
 * House directories that hold one ESLint rule per entry. The scan's rule-style
 * hints read the same list, so the two cannot drift.
 */
export const ESLINT_RULE_DIRECTORIES = [
  "eslint-rules",
  "eslint-local-rules",
  "tools/eslint-rules",
];

const FLAT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];

/** Packages that load rules from a file in the repository. */
const ESLINT_LOCAL_RULE_PACKAGES = [
  "eslint-plugin-local-rules",
  "eslint-plugin-local",
  "eslint-local-rules",
];

const RULE_SOURCE = /\.(?:[cm]?[jt]s)$/;
const NOT_A_RULE_FILE = /(?:^index\.|\.test\.|\.spec\.|\.d\.[cm]?ts$)/;
const NOT_A_RULE_DIRECTORY = new Set([
  "__tests__",
  "tests",
  "test",
  "fixtures",
  "utils",
  "util",
  "lib",
  "helpers",
]);

/**
 * Rules in a house rule directory: each source file is one rule, and so is
 * each subdirectory (a rule with its own folder). Index files, tests, type
 * declarations, and helper folders are not rules.
 *
 * An unreadable directory returns `undefined` rather than throwing: the scan
 * skips what it cannot read, and one bad directory must not fail `detect`.
 */
function countRuleDirectory(path: string): number | undefined {
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return undefined;
  }
  let count = 0;
  for (const entry of entries) {
    let isDirectory: boolean;
    try {
      isDirectory = statSync(join(path, entry)).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      if (!NOT_A_RULE_DIRECTORY.has(entry)) count++;
    } else if (RULE_SOURCE.test(entry) && !NOT_A_RULE_FILE.test(entry)) {
      count++;
    }
  }
  return count;
}

/** A relative import or require, the shape of a plugin loaded from a file. */
const RELATIVE_IMPORT = /(?:from\s*|require\(\s*)["']\.\.?\//;
/** A rule defined inside the config itself. */
const INLINE_RULE = /\bcreate\s*\(\s*context\b/;

async function countEslint(context: CustomRuleContext): Promise<CustomRules> {
  let known = 0;
  let unknown = false;
  const evidence: string[] = [];

  for (const directory of ESLINT_RULE_DIRECTORIES) {
    const path = resolve(context.root, directory);
    if (!existsSync(path)) continue;
    const count = countRuleDirectory(path);
    if (count === undefined) continue;
    known += count;
    evidence.push(`${directory} (${count} rules)`);
  }

  for (const name of FLAT_CONFIGS) {
    for (const relativePath of context.pathsFor(name)) {
      const source = await readText(resolve(context.root, relativePath));
      if (source === undefined || !/\bplugins\s*:/.test(source)) continue;
      if (INLINE_RULE.test(source)) {
        unknown = true;
        evidence.push(`${relativePath} (inline plugin rules)`);
      } else if (RELATIVE_IMPORT.test(source)) {
        unknown = true;
        evidence.push(`${relativePath} (plugin imported from a local file)`);
      }
    }
  }

  for (const manifest of context.nodeDeps) {
    for (const name of ESLINT_LOCAL_RULE_PACKAGES) {
      if (manifest.deps.has(name)) {
        unknown = true;
        evidence.push(`dependency ${name} (${manifest.path})`);
      }
    }
  }

  // A counted directory that already clears the threshold settles it; an
  // uncountable source can only add to it.
  const count = unknown && known < 5 ? "unknown" : known;
  return { count, evidence };
}

// --- Biome -------------------------------------------------------------------

/**
 * Parse JSONC: comments and trailing commas are dropped outside strings, so a
 * `$schema` URL keeps its `//`. Returns `undefined` for anything malformed.
 */
function parseJsonc(source: string): unknown {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === '"') {
      let end = index + 1;
      while (end < source.length && source[end] !== '"') {
        end += source[end] === "\\" ? 2 : 1;
      }
      out += source.slice(index, end + 1);
      index = end + 1;
    } else if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      out += char;
      index++;
    }
  }
  try {
    return JSON.parse(out.replaceAll(/,(\s*[}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

async function countBiome(context: CustomRuleContext): Promise<CustomRules> {
  let count = 0;
  const evidence: string[] = [];
  for (const name of ["biome.json", "biome.jsonc"]) {
    for (const relativePath of context.pathsFor(name)) {
      const source = await readText(resolve(context.root, relativePath));
      const plugins = asRecord(
        source === undefined ? undefined : parseJsonc(source)
      )?.plugins;
      if (!Array.isArray(plugins) || plugins.length === 0) continue;
      count += plugins.length;
      evidence.push(`${relativePath} (${plugins.length} plugins)`);
    }
  }
  return { count, evidence };
}

// --- Python INI --------------------------------------------------------------

/**
 * Read an INI file the way Python's `configparser` does for these keys:
 * `[section]` headers, `key = value` or `key: value`, and indented
 * continuation lines appended to the previous value. Comments start with `#`
 * or `;`. Keys are lowercased, as configparser does.
 */
function readIniSections(source: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  let lastKey: string | undefined;
  for (const raw of source.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    if (/^\s/.test(raw) && current && lastKey !== undefined) {
      current.set(lastKey, `${current.get(lastKey)}\n${trimmed}`);
      continue;
    }
    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header) {
      current = new Map();
      sections.set(header[1]!.trim(), current);
      lastKey = undefined;
      continue;
    }
    const property = /^([^=:]+)[=:](.*)$/.exec(trimmed);
    if (property && current) {
      lastKey = property[1]!.trim().toLowerCase();
      current.set(lastKey, property[2]!.trim());
    }
  }
  return sections;
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

// --- pylint ------------------------------------------------------------------

/**
 * Whether a dotted module name resolves to a file in the repository, looked
 * for beside the config, at the root, and under `src/`.
 */
function moduleInRepository(
  root: string,
  configDirectory: string,
  module: string
): boolean {
  const relative = module.replaceAll(".", "/");
  for (const base of [configDirectory, root, join(root, "src")]) {
    if (
      existsSync(join(base, `${relative}.py`)) ||
      existsSync(join(base, relative, "__init__.py"))
    ) {
      return true;
    }
  }
  return false;
}

/** `load-plugins` values from a parsed `pyproject.toml`'s `[tool.pylint.*]`. */
function pyprojectLoadPlugins(parsed: Record<string, unknown>): string[] {
  const pylint = asRecord(asRecord(parsed.tool)?.pylint);
  if (!pylint) return [];
  const plugins: string[] = [];
  for (const section of [pylint, ...Object.values(pylint)]) {
    const value = asRecord(section)?.["load-plugins"];
    if (typeof value === "string") plugins.push(...splitList(value));
    if (Array.isArray(value)) {
      plugins.push(
        ...value.filter((item): item is string => typeof item === "string")
      );
    }
  }
  return plugins;
}

async function countPylint(context: CustomRuleContext): Promise<CustomRules> {
  const named: Array<{ config: string; module: string }> = [];

  for (const name of [".pylintrc", "pylintrc"]) {
    for (const relativePath of context.pathsFor(name)) {
      const source = await readText(resolve(context.root, relativePath));
      if (source === undefined) continue;
      for (const section of readIniSections(source).values()) {
        const value = section.get("load-plugins");
        if (value === undefined) continue;
        for (const module of splitList(value)) {
          named.push({ config: relativePath, module });
        }
      }
    }
  }
  for (const pyproject of context.pyprojects) {
    if (!pyproject.parsed) continue;
    for (const module of pyprojectLoadPlugins(pyproject.parsed)) {
      named.push({ config: pyproject.path, module });
    }
  }

  const evidence: string[] = [];
  for (const { config, module } of named) {
    // Optional checkers that ship with pylint are first-party, not the
    // repository's own; third-party packages do not resolve to a file here.
    if (module.startsWith("pylint.")) continue;
    const configDirectory = dirname(resolve(context.root, config));
    if (moduleInRepository(context.root, configDirectory, module)) {
      evidence.push(`${config} load-plugins ${module}`);
    }
  }
  return { count: evidence.length, evidence };
}

// --- flake8 ------------------------------------------------------------------

async function countFlake8(context: CustomRuleContext): Promise<CustomRules> {
  let count = 0;
  const evidence: string[] = [];

  for (const name of [".flake8", "setup.cfg", "tox.ini"]) {
    for (const relativePath of context.pathsFor(name)) {
      const source = await readText(resolve(context.root, relativePath));
      if (source === undefined) continue;
      const extension = readIniSections(source)
        .get("flake8:local-plugins")
        ?.get("extension");
      if (extension === undefined) continue;
      // One `CODE = module:Class` per line registers one checker.
      const checkers = extension
        .split("\n")
        .filter((line) => line.includes("=")).length;
      if (checkers === 0) continue;
      count += checkers;
      evidence.push(`${relativePath} [flake8:local-plugins] (${checkers})`);
    }
  }

  for (const pyproject of context.pyprojects) {
    const entryPoints = asRecord(
      asRecord(asRecord(pyproject.parsed?.project)?.["entry-points"])?.[
        "flake8.extension"
      ]
    );
    const published = Object.keys(entryPoints ?? {}).length;
    if (published === 0) continue;
    count += published;
    evidence.push(
      `${pyproject.path} flake8.extension entry points (${published})`
    );
  }

  return { count, evidence };
}
