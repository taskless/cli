import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { CLIError } from "../util/cli-error";
import { isMissingDirectory } from "./errno";

/**
 * Engines this CLI knows. The directory name under `.taskless/rules/` **is**
 * the engine: dispatch reads the path and never parses a rule file to decide
 * who owns it.
 */
export const ENGINES = ["sg", "vale", "runtime"] as const;

export type EngineName = (typeof ENGINES)[number];

/** How a rule reaches execution, or `null` when this CLI has no executor yet. */
export type EngineExecutor =
  | "ast-grep"
  | "vale-runner"
  | "runtime-harness"
  | null;

export interface EngineLayout {
  engine: EngineName;
  /**
   * The file inside a rule directory that *is* the rule, as a function of the
   * rule id. `sg` and `vale` name it after the rule; `runtime` always calls it
   * `check.ts`, because the rule is a program rather than a document.
   */
  ruleFile: (ruleId: string) => string;
  /**
   * The engine's per-rule config file, or `undefined` where the engine has
   * nothing to put in one.
   *
   * Only Vale has one, and not for symmetry: Vale cannot express a rule's scope
   * inside the style file — measured, it rejects unknown keys with `E201` — so
   * scope needs somewhere else to live. ast-grep carries `files`/`ignores`
   * inside the rule itself, so an `sg` per-rule config would be a file every
   * author creates, no author fills, and every reader learns to ignore.
   */
  ruleConfigFile: string | undefined;
  /** Subdirectory holding ast-grep capture rules, for engines that use them. */
  capturesDirectory: string | undefined;
  executor: EngineExecutor;
}

/**
 * Everything defining a rule lives in one directory,
 * `.taskless/rules/<engine>/<id>/`, the same shape for every engine. A rule is
 * therefore one path — which is what lets `verify` and `test` take a path
 * instead of an id, and what makes deleting a rule an `rm -rf` of one thing.
 */
export const RULES_DIRECTORY = "rules";

/**
 * A rule's tests, relative to its rule directory. **The dot is load-bearing.**
 *
 * ast-grep's `ruleDirs` recurses and parses every `.yml` beneath it as a rule,
 * so a plain `tests/` directory inside a rule directory fails the entire scan
 * with `Fail to parse yaml as RuleConfig: missing field 'language'`. Measured
 * against ast-grep 0.41.0: `tests/` and `__tests__/` both hard-fail,
 * a dot-directory is skipped by rule discovery, and `sg test` still reads it
 * when `testDir` names it.
 *
 * That is undocumented behavior, and three things make depending on it
 * acceptable. The failure is loud — a parse error naming the file, never a test
 * silently reinterpreted as a rule. `ast-grep-vendor-contract.test.ts` pins it
 * alongside the rest of ast-grep's observed behavior, so it is
 * checked on every run rather than remembered. And the binary is pinned to an
 * exact version, so it cannot change without a deliberate bump, which is
 * exactly where that test fires.
 *
 * If it ever does break, the recorded fallback is to materialize a rules-only
 * tree for ast-grep and point `ruleDirs` at that (design D2).
 */
export const RULE_TESTS_DIRECTORY = ".tests";

export const ENGINE_LAYOUTS = {
  sg: {
    engine: "sg",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: undefined,
    capturesDirectory: undefined,
    executor: "ast-grep",
  },
  vale: {
    engine: "vale",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: ".vale.ini",
    capturesDirectory: undefined,
    executor: "vale-runner",
  },
  runtime: {
    engine: "runtime",
    ruleFile: () => "check.ts",
    ruleConfigFile: undefined,
    // `captures/` rather than `matchers/`: "matcher" denotes a Vale `[<glob>]`
    // config section elsewhere in this tree, and one word for two unrelated
    // concepts is a cost paid at every future reading.
    capturesDirectory: "captures",
    executor: "runtime-harness",
  },
} satisfies Record<EngineName, EngineLayout>;

/** `.taskless/rules`, the root every rule lives under. */
export function rulesRoot(cwd: string): string {
  return join(cwd, ".taskless", RULES_DIRECTORY);
}

/** `.taskless/rules/<engine>`, the directory holding that engine's rules. */
export function engineRulesDirectory(cwd: string, engine: EngineName): string {
  return join(rulesRoot(cwd), engine);
}

/** `.taskless/rules/<engine>/<id>` — the one path that means "this rule". */
export function ruleDirectory(
  cwd: string,
  engine: EngineName,
  ruleId: string
): string {
  return join(engineRulesDirectory(cwd, engine), ruleId);
}

/** The file inside a rule directory that is the rule itself. */
export function ruleFilePath(
  cwd: string,
  engine: EngineName,
  ruleId: string
): string {
  return join(
    ruleDirectory(cwd, engine, ruleId),
    ENGINE_LAYOUTS[engine].ruleFile(ruleId)
  );
}

/** A rule's tests directory. */
export function ruleTestsDirectory(
  cwd: string,
  engine: EngineName,
  ruleId: string
): string {
  return join(ruleDirectory(cwd, engine, ruleId), RULE_TESTS_DIRECTORY);
}

/** A rule's own engine config, for the one engine that has one. */
export function ruleConfigPath(
  cwd: string,
  engine: EngineName,
  ruleId: string
): string | undefined {
  const configFile = ENGINE_LAYOUTS[engine].ruleConfigFile;
  if (configFile === undefined) return undefined;
  return join(ruleDirectory(cwd, engine, ruleId), configFile);
}

/** A runtime rule's capture-rule directory. */
export function ruleCapturesDirectory(
  cwd: string,
  engine: EngineName,
  ruleId: string
): string | undefined {
  const capturesDirectory = ENGINE_LAYOUTS[engine].capturesDirectory;
  if (capturesDirectory === undefined) return undefined;
  return join(ruleDirectory(cwd, engine, ruleId), capturesDirectory);
}

/**
 * The assembled engine configs, relative to the project root.
 *
 * Both are **generated per run and gitignored**. Vale accepts exactly one
 * `--config` and ast-grep one `sgconfig.yml`, so per-rule configuration has to
 * reach a single file before either tool can be invoked. Committing that file
 * would recreate the shared, write-contended config this layout exists to
 * remove, by a different route.
 */
export const ASSEMBLED_VALE_CONFIG = ".taskless/.vale.ini";
export const ASSEMBLED_SG_CONFIG = ".taskless/.sgconfig.yml";

/** One engine's disposition for this run. */
export interface EngineDispatch {
  engine: EngineName;
  /** Whether `.taskless/rules/<engine>/` exists on disk. */
  present: boolean;
  executor: EngineExecutor;
}

/** Directory names directly under `directory`, or `[]` when it is not there. */
async function subdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Resolve which engine directories are present under `.taskless/rules/`.
 *
 * Only known engines are returned. A directory this CLI does not recognize is
 * ignored — never guessed at, never handed to another engine's parser — so a
 * `.taskless/` written by a newer CLI degrades to running the engines this one
 * understands.
 */
export async function planEngineDispatch(
  cwd: string
): Promise<EngineDispatch[]> {
  const directories = new Set(await subdirectories(rulesRoot(cwd)));
  return ENGINES.map((engine) => ({
    engine,
    present: directories.has(engine),
    executor: ENGINE_LAYOUTS[engine].executor,
  }));
}

/**
 * Rule ids for one engine — the directory names under `.taskless/rules/<engine>`.
 *
 * A rule is a directory, so this lists directories rather than file stems. A
 * stray *file* in an engine directory is not a rule and is skipped: the only
 * thing that makes something a rule is being a directory in the right place.
 *
 * Sorted, because assembly order is a correctness constraint. Vale's matcher
 * precedence is positional, so a config assembled in directory-iteration order
 * would give a rule a different effective scope on different machines.
 */
export async function listRuleIds(
  cwd: string,
  engine: EngineName
): Promise<string[]> {
  const ids = await subdirectories(engineRulesDirectory(cwd, engine));
  return ids.toSorted((a, b) => a.localeCompare(b));
}

/**
 * The engine whose directory holds `id`, or `undefined` if no engine does.
 *
 * A rule id is globally unique by construction (`<slug>-<sha1>`), so at most
 * one engine can hold it and the search order is not a tie-break. The search
 * exists because a rule id does not carry its engine: `.taskless/rules/` is
 * three sibling trees, and every operation that takes a bare id has to find
 * out which one it is in rather than assume.
 *
 * Assuming is what {@link deleteRuleFiles} used to do — it hardcoded `sg`, so
 * a delivered vale or runtime rule could be written and never removed. That is
 * the shape of bug this exists to prevent, and the reason it lives beside
 * {@link ENGINE_LAYOUTS} rather than in the one caller that first needed it.
 */
export async function findRuleEngine(
  cwd: string,
  id: string
): Promise<EngineName | undefined> {
  for (const engine of ENGINES) {
    try {
      const stats = await stat(ruleDirectory(cwd, engine, id));
      if (stats.isDirectory()) return engine;
    } catch (error) {
      // Only a genuinely absent directory means "not this engine". Swallowing
      // every failure would read `EACCES` on a rule directory as absence, and
      // the caller would then report a rule that is present but unreadable as
      // not found — telling the user to treat an existing rule as gone. That
      // is the same class of bug this function exists to fix, moved from
      // "wrong engine assumed" to "real error misreported as absence".
      if (!isMissingDirectory(error)) throw error;
    }
  }
  return undefined;
}

/**
 * Resolve the engine a service-delivered rule is filed under.
 *
 * The delivery API carries no engine discriminator — `/cli/api/rule/{ruleId}`
 * documents `rules[].content` as an ast-grep rule definition — so a payload
 * that identifies no engine **is** ast-grep. That default is permanent, not a
 * migration window: published CLIs keep receiving engine-less payloads, and it
 * files a delivered rule exactly where the migrations put the same rule already
 * on disk.
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

export function isKnownEngine(value: string): value is EngineName {
  return (ENGINES as readonly string[]).includes(value);
}
