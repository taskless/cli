import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { CheckResult } from "../types/check";
import { CLIError } from "../util/cli-error";

/**
 * Engines this CLI knows. The directory name under `.taskless/` **is** the
 * engine: dispatch reads the path and never parses a rule file to decide who
 * owns it.
 */
export const ENGINES = ["sg", "vale", "runtime"] as const;

export type EngineName = (typeof ENGINES)[number];

/** How a rule reaches execution, or `null` when this CLI has no executor yet. */
export type EngineExecutor = "ast-grep" | "runtime-harness" | null;

export interface EngineLayout {
  engine: EngineName;
  /** Rules directory, relative to `.taskless/`. */
  rulesDirectory: string;
  /** Rule-tests directory, relative to `.taskless/`. */
  ruleTestsDirectory: string;
  /** The engine's native config, relative to `.taskless/`. */
  configFile: string | undefined;
  executor: EngineExecutor;
}

export const ENGINE_LAYOUTS = {
  sg: {
    engine: "sg",
    rulesDirectory: "sg/rules",
    ruleTestsDirectory: "sg/rule-tests",
    configFile: "sg/sgconfig.yml",
    executor: "ast-grep",
  },
  vale: {
    engine: "vale",
    rulesDirectory: "vale/rules",
    ruleTestsDirectory: "vale/rule-tests",
    configFile: "vale/.vale.ini",
    // Scaffolded but inert: the Vale engine itself is a later change.
    executor: null,
  },
  runtime: {
    engine: "runtime",
    rulesDirectory: "runtime/rules",
    ruleTestsDirectory: "runtime/rule-tests",
    configFile: undefined,
    executor: "runtime-harness",
  },
} satisfies Record<EngineName, EngineLayout>;

/**
 * The committed ast-grep config, relative to the project root. It is authored
 * and persisted, never generated at check time: its `ruleDirs`/`testConfigs`
 * are relative to the config file, so it needs no rewriting to stay valid.
 *
 * Declared here beside the layout it derives from. `engines.ts` imports nothing
 * of ours but the error type, so both the filesystem and rules layers can reach
 * this constant without either pulling in the other's machinery.
 */
export const COMMITTED_SG_CONFIG = `.taskless/${ENGINE_LAYOUTS.sg.configFile}`;

/**
 * The pre-`0004` ast-grep locations. Still dispatched as ast-grep so an
 * unmigrated checkout — or a producer that keeps naming the old path — runs
 * rather than being silently ignored.
 */
export const LEGACY_RULES_DIRECTORY = "rules";
export const LEGACY_RULE_TESTS_DIRECTORY = "rule-tests";

export function isKnownEngine(value: string): value is EngineName {
  return (ENGINES as readonly string[]).includes(value);
}

/** One engine directory's disposition for this run. */
export interface EngineDispatch {
  engine: EngineName;
  /** Whether `.taskless/<engine>/` exists on disk. */
  present: boolean;
  executor: EngineExecutor;
}

/** Directory entries of `.taskless/`, or `[]` when it does not exist. */
async function readTasklessEntries(cwd: string): Promise<Set<string>> {
  try {
    const entries = await readdir(join(cwd, ".taskless"), {
      withFileTypes: true,
    });
    return new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

/**
 * Resolve which engine directories are present under `.taskless/`.
 *
 * Only known engines are returned. A directory this CLI does not recognize is
 * ignored — never guessed at, never handed to another engine's parser — so a
 * `.taskless/` written by a newer CLI degrades to running the engines this one
 * understands.
 */
export async function planEngineDispatch(
  cwd: string
): Promise<EngineDispatch[]> {
  const directories = await readTasklessEntries(cwd);
  return ENGINES.map((engine) => ({
    engine,
    present: directories.has(engine),
    executor: ENGINE_LAYOUTS[engine].executor,
  }));
}

/** Rule ids (filename stems) of the `*.yml` files directly in `directory`. */
async function listRuleIds(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    return entries
      .filter((entry) => entry.endsWith(".yml"))
      .map((entry) => entry.slice(0, -".yml".length));
  } catch {
    return [];
  }
}

/** A directory of ast-grep rule files, and where its tests live. */
export interface AstGrepRuleSource {
  /** Rules directory, relative to `.taskless/`. */
  rulesDirectory: string;
  /** Rule-tests directory, relative to `.taskless/`. */
  ruleTestsDirectory: string;
  /** Absolute path to the rules directory. */
  absoluteRulesDirectory: string;
  /** Rule ids found in the directory. */
  ruleIds: string[];
  /** Whether this is the pre-`0004` location. */
  legacy: boolean;
}

/**
 * Every directory whose rules ast-grep should run: the `sg` engine directory
 * and, when it still holds rules, the legacy `.taskless/rules/`.
 *
 * A source with no rule files is omitted, so a scaffolded-but-empty `sg/rules/`
 * costs nothing. The `sg` source comes first; callers de-duplicate findings
 * ({@link dedupeFindings}) rather than dropping a source, since a rule id can
 * legitimately exist in only one of the two.
 */
export async function discoverAstGrepRuleSources(
  cwd: string
): Promise<AstGrepRuleSource[]> {
  const dispatch = await planEngineDispatch(cwd);
  const sgPresent =
    dispatch.find((entry) => entry.engine === "sg")?.present === true;

  const candidates: Array<Omit<AstGrepRuleSource, "ruleIds">> = [];
  if (sgPresent) {
    const layout = ENGINE_LAYOUTS.sg;
    candidates.push({
      rulesDirectory: layout.rulesDirectory,
      ruleTestsDirectory: layout.ruleTestsDirectory,
      absoluteRulesDirectory: join(cwd, ".taskless", layout.rulesDirectory),
      legacy: false,
    });
  }
  candidates.push({
    rulesDirectory: LEGACY_RULES_DIRECTORY,
    ruleTestsDirectory: LEGACY_RULE_TESTS_DIRECTORY,
    absoluteRulesDirectory: join(cwd, ".taskless", LEGACY_RULES_DIRECTORY),
    legacy: true,
  });

  const sources: AstGrepRuleSource[] = [];
  for (const candidate of candidates) {
    const ruleIds = await listRuleIds(candidate.absoluteRulesDirectory);
    if (ruleIds.length === 0) continue;
    sources.push({ ...candidate, ruleIds });
  }
  return sources;
}

/**
 * Collapse findings that describe the same match. Scanning both `sg/rules/` and
 * the legacy `rules/` means a rule present in both reports twice; the finding
 * itself is the identity, so an identical match from either source is reported
 * once.
 */
export function dedupeFindings(results: CheckResult[]): CheckResult[] {
  const seen = new Set<string>();
  const unique: CheckResult[] = [];
  for (const result of results) {
    const key = [
      result.ruleId,
      result.file,
      result.range.start.line,
      result.range.start.column,
      result.range.end.line,
      result.range.end.column,
      result.message,
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

/**
 * Candidate locations of a single ast-grep rule file, in resolution order:
 * the `sg` engine directory first, the legacy path second.
 */
export function astGrepRuleFileCandidates(
  cwd: string,
  ruleId: string
): string[] {
  return [
    join(cwd, ".taskless", ENGINE_LAYOUTS.sg.rulesDirectory, `${ruleId}.yml`),
    join(cwd, ".taskless", LEGACY_RULES_DIRECTORY, `${ruleId}.yml`),
  ];
}

/**
 * Resolve the engine a service-delivered rule is filed under.
 *
 * The delivery API carries no engine discriminator — `/cli/api/rule/{ruleId}`
 * documents `rules[].content` as an ast-grep rule definition — so a payload
 * that identifies no engine **is** ast-grep. That default is permanent, not a
 * migration window: published CLIs keep receiving engine-less payloads, and it
 * files a delivered rule exactly where migration `0004` puts the same rule
 * already on disk.
 *
 * Absence and an unrecognized value are different. An engine this CLI does not
 * know means the payload is newer than the CLI; defaulting it to `sg` would
 * file it where the wrong parser reads it, surfacing as a broken rule rather
 * than version skew. That throws, and nothing is written.
 */
export function resolveIngestEngine(payload: unknown): EngineName {
  const declared =
    typeof payload === "object" &&
    payload !== null &&
    "engine" in payload &&
    typeof (payload as { engine?: unknown }).engine === "string"
      ? (payload as { engine: string }).engine.trim()
      : "";

  if (declared === "") return "sg";
  if (!isKnownEngine(declared)) {
    throw new CLIError(
      `Rule engine "${declared}" is not supported by this CLI. Upgrade the CLI to use rules for this engine.`,
      "RULE_UNSUPPORTED"
    );
  }
  return declared;
}

/** Candidate rule-test directories, in the same resolution order. */
export function astGrepRuleTestDirectories(cwd: string): string[] {
  return [
    join(cwd, ".taskless", ENGINE_LAYOUTS.sg.ruleTestsDirectory),
    join(cwd, ".taskless", LEGACY_RULE_TESTS_DIRECTORY),
  ];
}
