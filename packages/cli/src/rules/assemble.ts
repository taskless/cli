import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import {
  ASSEMBLED_SG_CONFIG,
  ASSEMBLED_VALE_CONFIG,
  listRuleIds,
  ruleConfigPath,
  ruleTestsDirectory,
} from "./engines";
import { RULE_TESTS_DIRECTORY, RULES_DIRECTORY } from "./layout";

/**
 * Assembling the per-rule configs into the single file each tool accepts.
 *
 * Vale takes exactly one `--config` and ast-grep one `sgconfig.yml`, so
 * per-rule configuration has to reach one file before either can be invoked.
 * The committed source of truth stays per-rule; what the tool reads is
 * generated here and gitignored.
 *
 * **Determinism is a correctness constraint, not tidiness.** Vale's matcher
 * precedence is positional — across matchers the last wins, within one matcher
 * the first assignment wins — so a config assembled in directory-iteration
 * order would give a rule a different effective scope depending on the machine
 * it ran on. Rules are therefore emitted in sorted id order, and each rule's own
 * matcher order is preserved verbatim.
 *
 * A consequence worth naming: a rule cannot override another rule's matchers,
 * because it cannot know its own position in the assembled file. That coupling
 * is exactly what per-rule configs remove.
 */

/** Path within `.taskless/`, in the POSIX form both tools' configs expect. */
function tasklessRelative(...segments: string[]): string {
  return segments.join(posix.sep);
}

/** Normalize a filesystem path to POSIX separators for config output. */
function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** Whether `path` is a directory on disk. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The header every assembled Vale config carries.
 *
 * `StylesPath` points at the Vale rules tree so each rule directory is a style,
 * which is what makes a rule at `<id>/<id>.yml` resolve as check `<id>.<id>`.
 * Measured: under `StylesPath = .` that same file resolves to nothing at all.
 *
 * `MinAlertLevel = suggestion` so every finding reaches the client, which
 * filters and normalizes rather than relying on Vale to decide what matters.
 */
function valeHeader(): string {
  return [
    `StylesPath = ${tasklessRelative(RULES_DIRECTORY, "vale")}`,
    "MinAlertLevel = suggestion",
    "",
  ].join("\n");
}

/**
 * Read a rule's own config, dropping a leading `StylesPath`/`MinAlertLevel` if
 * an author copied one in.
 *
 * Those two are properties of the run, not of a rule, and a per-rule copy would
 * either be redundant or silently fight the header. Everything else — matchers,
 * assignments, `tskl)` breadcrumbs, comments — is carried through **verbatim**,
 * because matcher order inside a rule is the author's expression of precedence.
 */
function ruleConfigBody(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  let seenSection = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("[")) seenSection = true;
    if (!seenSection) {
      const key = line.split("=")[0]?.trim().toLowerCase();
      if (key === "stylespath" || key === "minalertlevel") continue;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** A rule's assembled block, tagged so its provenance survives interleaving. */
function valeRuleBlock(ruleId: string, body: string): string {
  return [`# tskl) rule = ${ruleId}`, body, ""].join("\n");
}

/**
 * Assemble `.taskless/.vale.ini` from every Vale rule's own config.
 *
 * Returns the config path relative to the project root, or `undefined` when no
 * Vale rule declares any config — there is nothing to run, and writing an empty
 * config would invite Vale to lint the project against no rules and report a
 * clean pass.
 */
export async function assembleValeConfig(
  cwd: string
): Promise<string | undefined> {
  const ruleIds = await listRuleIds(cwd, "vale");
  const blocks: string[] = [];

  for (const ruleId of ruleIds) {
    const configPath = ruleConfigPath(cwd, "vale", ruleId);
    if (configPath === undefined) continue;
    let source: string;
    try {
      source = await readFile(configPath, "utf8");
    } catch {
      // A rule with no config of its own declares no scope, so it is enabled
      // nowhere. That is the author's omission to fix, not ours to guess at —
      // `verify` reports it.
      continue;
    }
    const body = ruleConfigBody(source);
    if (body === "") continue;
    blocks.push(valeRuleBlock(ruleId, body));
  }

  if (blocks.length === 0) return undefined;

  const contents = [valeHeader(), ...blocks].join("\n");
  const target = join(cwd, ASSEMBLED_VALE_CONFIG);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return ASSEMBLED_VALE_CONFIG;
}

/**
 * Assemble `.taskless/.sgconfig.yml`.
 *
 * `ruleDirs` names the ast-grep rules tree, which ast-grep walks recursively —
 * that recursion is why tests live in `.tests/` rather than `tests/`, since
 * every `.yml` it reaches is parsed as a rule.
 *
 * `testConfigs` gets one entry per rule, because each rule keeps its tests
 * inside its own directory. Sorted with the rule ids, so the file is stable.
 *
 * A rule whose `.tests/` is not on disk is left out of `testConfigs`
 * entirely. **ast-grep 0.41.0 treats a missing `testDir` as fatal to the whole
 * invocation** — `Cannot read rule directory ...`, exit 6 — and `--filter` does
 * not scope that away, so emitting the entry regardless would let one rule fail
 * every other rule's test run, with an error naming a rule its author never
 * touched. Migration `0005` now creates the directory, but that does not make
 * this check redundant: `runMigrations` short-circuits once the manifest reads
 * version 5, so a project a nightly already stamped never re-runs the amended
 * migration, and a hand-made `mkdir .taskless/rules/sg/<id>/` reaches the same
 * state on any version. Nothing becomes a silent pass — `verify` still reports
 * "No test file found" and `test` still reports "Skipped: no test file found",
 * both of which read the rule directory rather than this config.
 */
export async function assembleSgConfig(
  cwd: string
): Promise<string | undefined> {
  const ruleIds = await listRuleIds(cwd, "sg");
  if (ruleIds.length === 0) return undefined;

  const rulesDirectory = tasklessRelative(RULES_DIRECTORY, "sg");
  const candidates = ruleIds.map((ruleId) =>
    ruleTestsDirectory(cwd, "sg", ruleId)
  );
  const present = await Promise.all(
    candidates.map((path) => isDirectory(path))
  );
  const testDirectories = candidates
    .filter((_, index) => present[index])
    .map((path) => toPosix(relative(join(cwd, ".taskless"), path)));

  const contents = [
    "ruleDirs:",
    `  - ${rulesDirectory}`,
    "testConfigs:",
    ...testDirectories.map((directory) => `  - testDir: ${directory}`),
    "",
  ].join("\n");

  const target = join(cwd, ASSEMBLED_SG_CONFIG);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return ASSEMBLED_SG_CONFIG;
}

/** Both assembled configs, for a run that needs whichever engines are present. */
export interface AssembledConfigs {
  /** `--config` for Vale, or `undefined` when no Vale rule is configured. */
  vale: string | undefined;
  /** `-c` for ast-grep, or `undefined` when there are no ast-grep rules. */
  sg: string | undefined;
}

export async function assembleEngineConfigs(
  cwd: string
): Promise<AssembledConfigs> {
  const [vale, sg] = await Promise.all([
    assembleValeConfig(cwd),
    assembleSgConfig(cwd),
  ]);
  return { vale, sg };
}

/** Exported for the assembly tests, which assert on the artifact directly. */
export const ASSEMBLY_INTERNALS = {
  ruleConfigBody,
  valeHeader,
  RULE_TESTS_DIRECTORY,
};
