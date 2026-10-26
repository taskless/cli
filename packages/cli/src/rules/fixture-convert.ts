import { matchesGlob, posix } from "node:path";

import { parseDocument } from "yaml";

import { resolveAstGrepLanguage, type AstGrepLanguage } from "./capabilities";
import type { FixtureBucket } from "./fixtures";
import { parseValeRuleConfig } from "../schemas/vale-config";

/**
 * Converting fixtures from the legacy `.tests/` layout into case directories.
 *
 * Shared by migration `12`, which converts a project's rules once, and by
 * delivery, which reads a served set in the legacy layout and converts it
 * before writing, so the service is never required to move. Pure: it takes
 * file contents and returns file contents, and touches no filesystem.
 *
 * A converted fixture has to sit at a path the rule's scope accepts, because
 * a case is judged by the engine's own check with the case as its root. An
 * ast-grep snippet used to be scanned over stdin, which bypasses `files:`, so
 * a snippet placed anywhere else would turn into a quiet `fail/` case the
 * moment it was migrated. The path is derived from the scope's own patterns
 * and then checked against them with `node:path`'s `matchesGlob`. That dialect
 * is close to ast-grep's `globset` and to Vale's matcher globs but is not
 * identical, so the check catches a derivation mistake rather than proving the
 * engine agrees. The next `verify` is the proof, and it names a scope that
 * excluded a case.
 */

/**
 * The file extension a snippet in each ast-grep language is written with.
 *
 * Keyed on {@link AstGrepLanguage}, so the type checker refuses a table that
 * misses a language, and that list is itself pinned by set-equality against
 * the binary in `ast-grep-vendor-contract.test.ts`. Each extension is one
 * ast-grep parses as that language by default, which the same test checks by
 * scanning a file of each.
 */
export const AST_GREP_LANGUAGE_EXTENSIONS: Readonly<
  Record<AstGrepLanguage, string>
> = {
  Bash: "sh",
  C: "c",
  Cpp: "cpp",
  CSharp: "cs",
  Css: "css",
  Dart: "dart",
  Elixir: "ex",
  Go: "go",
  Haskell: "hs",
  Hcl: "hcl",
  Html: "html",
  Java: "java",
  JavaScript: "js",
  Json: "json",
  Kotlin: "kt",
  Lua: "lua",
  Markdown: "md",
  Nix: "nix",
  Php: "php",
  Python: "py",
  Ruby: "rb",
  Rust: "rs",
  Scala: "scala",
  Solidity: "sol",
  Swift: "swift",
  Tsx: "tsx",
  TypeScript: "ts",
  Yaml: "yml",
  Zig: "zig",
};

/** A rule's scope: the globs that admit a file, and the globs that exclude one. */
export interface FixtureScope {
  include: string[];
  exclude: string[];
}

/** The first alternative of the first `{a,b}` group, preferring one ending in `.<extension>`. */
function expandFirstBrace(glob: string, extension: string): string {
  const match = /\{([^{}]*)\}/.exec(glob);
  if (match?.[1] === undefined) return glob;
  const alternatives = match[1].split(",");
  const preferred =
    alternatives.find((alternative) =>
      `${glob.slice(0, match.index)}${alternative}`.endsWith(`.${extension}`)
    ) ??
    alternatives.find((alternative) => alternative === extension) ??
    alternatives[0] ??
    "";
  return expandFirstBrace(
    `${glob.slice(0, match.index)}${preferred}${glob.slice(match.index + match[0].length)}`,
    extension
  );
}

/** A concrete path for one glob, standing in `stem` for every wildcard. */
function pathFromGlob(glob: string, stem: string, extension: string): string {
  let path = expandFirstBrace(glob.replace(/^\.\//, ""), extension);
  // A trailing `/**` admits anything beneath, so a file goes beneath it.
  if (path.endsWith("/**")) path = `${path.slice(0, -2)}${stem}.${extension}`;
  if (path === "**") path = `${stem}.${extension}`;
  path = path
    .replaceAll("**/", "")
    .replaceAll("**", stem)
    .replaceAll("*", stem)
    .replaceAll("?", "x")
    .replaceAll(/\[!?([^\]])[^\]]*\]/g, "$1");
  return path;
}

/** Whether `path` is admitted by `scope`, in `node:path`'s glob dialect. */
function admitted(path: string, scope: FixtureScope): boolean {
  const included =
    scope.include.length === 0 ||
    scope.include.some((glob) => matchesGlob(path, glob));
  return included && !scope.exclude.some((glob) => matchesGlob(path, glob));
}

/**
 * A path for a fixture file named `stem.extension` that `scope` admits, or
 * `undefined` when none of the derivations could be checked.
 *
 * A path keeping `.extension` is preferred over an earlier glob's that does
 * not: both engines choose how to read a file by its extension, so under
 * `[*.md]` and `[*.txt]` a `.txt` document written as `.md` would be linted
 * as Markdown.
 */
export function deriveFixturePath(
  scope: FixtureScope,
  stem: string,
  extension: string
): string | undefined {
  const derived =
    scope.include.length === 0
      ? [`${stem}.${extension}`]
      : scope.include.map((glob) => pathFromGlob(glob, stem, extension));
  const candidates = [
    ...derived.filter((path) => path.endsWith(`.${extension}`)),
    ...derived.filter((path) => !path.endsWith(`.${extension}`)),
  ];
  return candidates.find(
    (candidate) =>
      candidate !== "" &&
      !candidate.startsWith("/") &&
      !candidate.split("/").includes("..") &&
      admitted(candidate, scope)
  );
}

/** The globs out of a `files:`/`ignores:` value, in either shape ast-grep accepts. */
function globList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): unknown =>
      typeof entry === "object" && entry !== null && "glob" in entry
        ? (entry as { glob: unknown }).glob
        : entry
    )
    .filter((glob): glob is string => typeof glob === "string");
}

/** Whether a parsed YAML value is a mapping, not a scalar or a list. */
function isMapping(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One converted fixture file, at a path relative to the rule directory. */
export interface ConvertedFile {
  path: string;
  content: string;
}

/**
 * The cases a rule's conversion has already written, as `<bucket>/<case>`.
 *
 * A rule can own several legacy test files (one per authoring round, dated
 * `<id>-YYYYMMDD-test.yml`), and each numbers its snippets from one. Sharing
 * this set across a rule's conversions is what keeps the second file's
 * `fail-01` from landing on the first file's.
 */
export type ClaimedCases = Set<string>;

/** The first `<base>`, `<base>-2`, `<base>-3`, … not yet in `claimed`. */
function claimCase(
  claimed: ClaimedCases,
  bucket: FixtureBucket,
  name: (attempt: number) => string
): string {
  for (let attempt = 1; ; attempt++) {
    const candidate = name(attempt);
    if (!claimed.has(`${bucket}/${candidate}`)) {
      claimed.add(`${bucket}/${candidate}`);
      return candidate;
    }
  }
}

/** What one conversion produced, and what it had to leave alone. */
export interface Conversion {
  files: ConvertedFile[];
  /** Why something was left unconverted, one line each, naming the source. */
  unconverted: string[];
}

/**
 * Convert one ast-grep test YAML into case directories.
 *
 * One case per `valid:` (pass) or `invalid:` (fail) snippet, named by bucket
 * and ordinal in source order, since a snippet carries no description to name
 * it by. Ordinals continue past any case in `claimed`, which a successful
 * conversion adds its own cases to. `rule` is the rule file's content, which
 * supplies `language:` and the scope. `name` is the test file's name, for
 * messages.
 *
 * Unconverted (and so left in place by the caller) when the test file does not
 * parse, the language has no extension, or no admitted path can be derived.
 * All or nothing per test file, so a partly converted file never strands half
 * its snippets.
 */
export function convertSgTestFile(
  rule: string,
  name: string,
  content: string,
  testsDirectory: string,
  claimed: ClaimedCases = new Set()
): Conversion {
  const unconvertible = (reason: string): Conversion => ({
    files: [],
    unconverted: [`${name}: ${reason}`],
  });

  // `parseDocument` collects syntax errors rather than throwing, so a
  // half-parsed file has to be refused here: converting what did parse would
  // turn `invalid: [unterminated` into a case holding `unterminated`.
  const ruleParsed = parseDocument(rule);
  const testParsed = parseDocument(content);
  if (ruleParsed.errors.length > 0 || testParsed.errors.length > 0) {
    return unconvertible("the rule or the test file is not valid YAML");
  }
  const ruleDocument: unknown = ruleParsed.toJS();
  const testDocument: unknown = testParsed.toJS();
  if (!isMapping(ruleDocument)) {
    return unconvertible("the rule file is not a YAML mapping");
  }
  if (!isMapping(testDocument)) {
    return unconvertible("the test file is not a YAML mapping");
  }
  const ruleRecord = ruleDocument as Record<string, unknown>;
  const test = testDocument as Record<string, unknown>;

  const language =
    typeof ruleRecord.language === "string"
      ? resolveAstGrepLanguage(ruleRecord.language)
      : undefined;
  if (language === undefined) {
    return unconvertible(
      `language ${JSON.stringify(ruleRecord.language)} has no file extension to write a snippet with`
    );
  }
  const extension = AST_GREP_LANGUAGE_EXTENSIONS[language];
  const scope: FixtureScope = {
    include: globList(ruleRecord.files),
    exclude: globList(ruleRecord.ignores),
  };

  // Claimed into a copy, so a file refused part-way claims nothing.
  const claiming = new Set(claimed);
  const files: ConvertedFile[] = [];
  const buckets: [FixtureBucket, unknown][] = [
    ["pass", test.valid],
    ["fail", test.invalid],
  ];
  for (const [bucket, snippets] of buckets) {
    if (snippets === undefined) continue;
    if (!Array.isArray(snippets)) {
      return unconvertible(
        `its ${bucket === "pass" ? "valid" : "invalid"}: key is not a list`
      );
    }
    for (const snippet of snippets) {
      if (typeof snippet !== "string") {
        return unconvertible(
          `a ${bucket === "pass" ? "valid" : "invalid"}: entry is not a string`
        );
      }
      const caseName = claimCase(
        claiming,
        bucket,
        (ordinal) => `${bucket}-${String(ordinal).padStart(2, "0")}`
      );
      const path = deriveFixturePath(scope, caseName, extension);
      if (path === undefined) {
        return unconvertible(
          `no path could be derived that the rule's files:/ignores: admit`
        );
      }
      files.push({
        path: posix.join(testsDirectory, bucket, caseName, path),
        content: snippet.endsWith("\n") ? snippet : `${snippet}\n`,
      });
    }
  }
  for (const entry of claiming) claimed.add(entry);
  return { files, unconverted: [] };
}

/**
 * The scope a Vale rule's `.vale.ini` declares: every matcher assigning
 * `<id>.<id> = YES` admits, every one assigning `NO` excludes.
 *
 * Positional precedence is flattened, deliberately. A path is admitted when
 * some enabling matcher matches it and no disabling one does, which is
 * stricter than Vale and so never derives a path Vale would exclude.
 */
export function valeFixtureScope(ruleId: string, config: string): FixtureScope {
  const key = `${ruleId}.${ruleId}`;
  const scope: FixtureScope = { include: [], exclude: [] };
  for (const section of parseValeRuleConfig(config).sections) {
    if (section.name === undefined) continue;
    for (const node of section.nodes) {
      if (node.kind !== "property" || node.key !== key) continue;
      const value = node.value.trim().toUpperCase();
      if (value === "YES") scope.include.push(section.name);
      if (value === "NO") scope.exclude.push(section.name);
    }
  }
  return scope;
}

/**
 * Convert one legacy Vale fixture document, `.tests/<bucket>/<name>`, into a
 * case directory named for the document's stem.
 *
 * The document keeps its own name and extension, placed at a path the rule's
 * enabling matchers admit. Two documents sharing a stem (`a.md`, `a.txt`) get
 * `a` and `a-2`, through `claimed`. Unconverted when no such path can be derived. A
 * rule with no enabling matcher cannot have one, and `validate` reports that
 * rule as off before it reports anything about its fixtures.
 */
export function convertValeDocument(
  scope: FixtureScope,
  bucket: FixtureBucket,
  name: string,
  content: string,
  testsDirectory: string,
  claimed: ClaimedCases = new Set()
): Conversion {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot + 1);
  const derived =
    extension === "" ? undefined : deriveFixturePath(scope, stem, extension);
  if (derived === undefined) {
    return {
      files: [],
      unconverted: [
        `${bucket}/${name}: no path could be derived that the rule's .vale.ini matchers admit`,
      ],
    };
  }
  const caseName = claimCase(claimed, bucket, (attempt) =>
    attempt === 1 ? stem : `${stem}-${String(attempt)}`
  );
  return {
    files: [
      { path: posix.join(testsDirectory, bucket, caseName, derived), content },
    ],
    unconverted: [],
  };
}

/** A served file, as delivery carries it: a rule-relative path and its bytes. */
export interface LegacyFile {
  path: string;
  content: string;
}

/**
 * A served file set with any fixtures in the legacy `.tests/` layout rewritten
 * into case directories under `tests/`.
 *
 * What lets delivery read a service that has not moved, permanently rather
 * than as a transition step: every file outside `.tests/` passes through
 * byte-identical, and a set already in the new layout is returned unchanged.
 * Fixtures carry no signature, so nothing this rewrites is a signed byte.
 *
 * A fixture that cannot be placed keeps its bytes and moves to the same path
 * under `tests/`, so the CLI still never writes `.tests/`. `verify` then names
 * it, and `unconverted` says why, for the delivery to warn with.
 */
export function convertLegacyFileSet(
  engine: "sg" | "vale" | "runtime",
  ruleId: string,
  files: readonly LegacyFile[],
  legacyDirectory: string,
  testsDirectory: string
): { files: LegacyFile[]; unconverted: string[] } {
  const prefix = `${legacyDirectory}/`;
  const legacy = files.filter((file) => file.path.startsWith(prefix));
  if (legacy.length === 0) return { files: [...files], unconverted: [] };

  const kept = files.filter((file) => !file.path.startsWith(prefix));
  const converted: LegacyFile[] = [];
  const unconverted: string[] = [];
  const claimed: ClaimedCases = new Set();
  const moveAsServed = (file: LegacyFile) => {
    converted.push({
      path: `${testsDirectory}/${file.path.slice(prefix.length)}`,
      content: file.content,
    });
  };
  const take = (conversion: Conversion, file: LegacyFile) => {
    if (conversion.unconverted.length > 0) {
      unconverted.push(...conversion.unconverted);
      moveAsServed(file);
      return;
    }
    converted.push(...conversion.files);
  };

  const sibling = (name: string) =>
    files.find((file) => file.path === name)?.content;

  for (const file of legacy) {
    const rest = file.path.slice(prefix.length);
    const segments = rest.split("/");
    if (engine === "sg") {
      const rule = sibling(`${ruleId}.yml`);
      if (segments.length !== 1 || rule === undefined) {
        unconverted.push(`${rest}: not an ast-grep test file beside its rule`);
        moveAsServed(file);
        continue;
      }
      take(
        convertSgTestFile(rule, rest, file.content, testsDirectory, claimed),
        file
      );
      continue;
    }
    const [bucket, ...below] = segments;
    if (bucket !== "pass" && bucket !== "fail") {
      unconverted.push(`${rest}: not under pass/ or fail/`);
      moveAsServed(file);
      continue;
    }
    if (engine === "runtime") {
      // Already a case directory: only the parent changes.
      moveAsServed(file);
      continue;
    }
    const [name] = below;
    if (below.length !== 1 || name === undefined) {
      unconverted.push(
        `${rest}: a Vale fixture is one document directly in its bucket`
      );
      moveAsServed(file);
      continue;
    }
    const scope = valeFixtureScope(ruleId, sibling(".vale.ini") ?? "");
    take(
      convertValeDocument(
        scope,
        bucket,
        name,
        file.content,
        testsDirectory,
        claimed
      ),
      file
    );
  }
  return { files: [...kept, ...converted], unconverted };
}
