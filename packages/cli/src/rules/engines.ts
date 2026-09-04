import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { CLIError } from "../util/cli-error";
import { isMissingDirectory } from "./errno";
import {
  ENGINE_LAYOUTS,
  ENGINES,
  isKnownEngine,
  RULE_TESTS_DIRECTORY,
  RULES_DIRECTORY,
  TASKLESS_DIRECTORY,
  type EngineExecutor,
  type EngineName,
} from "./layout";

/** `.taskless/rules`, the root every rule lives under. */
export function rulesRoot(cwd: string): string {
  return join(cwd, TASKLESS_DIRECTORY, RULES_DIRECTORY);
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
 * The delivery API carries no engine discriminator — `/cli/api/request/{requestId}`
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
