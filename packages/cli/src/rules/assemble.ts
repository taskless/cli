import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";

import {
  ASSEMBLED_SG_CONFIG,
  ASSEMBLED_VALE_CONFIG,
  listRuleIds,
  ruleConfigPath,
  ruleTestsDirectory,
} from "./engines";
import { validateValeRuleConfig } from "../schemas/vale-config";
import type { RuleViolation } from "./constraints";
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
 * precedence is positional — across matchers the last wins, and since Vale
 * 3.21.0 so does the last assignment within one matcher (through 3.20.0 it was
 * the first; `vale-vendor-contract.test.ts` pins the current answer) — so a
 * config assembled in directory-iteration order would give a rule a different
 * effective scope depending on the machine it ran on. Rules are therefore
 * emitted in sorted id order, and each rule's own matcher order is preserved
 * verbatim.
 *
 * A consequence worth naming: a rule cannot override another rule's matchers,
 * because it cannot know its own position in the assembled file. That coupling
 * is exactly what per-rule configs remove.
 *
 * **Interleaving is also why a rule's config may not carry `BasedOnStyles`.**
 * Since Vale 3.22.0 an empty value clears every setting a file inherited from
 * an earlier matcher, and here "earlier" means every other rule whose glob
 * reaches the file, so a rule writing `BasedOnStyles =` under `[docs/**]`
 * silences every alphabetically earlier rule under `docs/`. Only a
 * byte-identical glob, which Vale merges into one section, escapes. The
 * schema refuses the key (`vale-config-no-based-on-styles`) and migration
 * 0008 deletes it from installed configs; `vale-vendor-contract.test.ts`
 * pins the measurement on the exact layout this module writes.
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
 * A rule's assembled block: its breadcrumb comment, then its config verbatim.
 *
 * The config is the generator's structured input and is never re-serialized.
 * The schema has already read it as an AST, for validation and for the matcher
 * list; what Vale reads is the file's own bytes, so matcher order, comments and
 * spacing survive exactly as the author wrote them. Matcher order inside a rule
 * is the author's expression of precedence, so anything short of verbatim
 * would be a semantic edit. The only addition is a newline after a source that
 * lacks one, so the next rule's breadcrumb starts its own line.
 *
 * This is also why the schema, not this module, turns away a copied-in
 * `StylesPath` or `MinAlertLevel`. Assembly used to strip those two by
 * splitting each line on `=`; that was the one string edit it performed, and
 * it meant the file Vale read was not the file the author wrote. A run-level
 * key above the first matcher is now a rejection, so there is nothing left to
 * strip.
 */
function valeRuleBlock(ruleId: string, source: string): string {
  const terminated = source.endsWith("\n") ? source : `${source}\n`;
  return `# tskl) rule = ${ruleId}\n${terminated}`;
}

/** One rule whose config the schema refused. */
export interface ValeConfigRefusal {
  ruleId: string;
  /** Every rejection, each naming the line and the constraint it broke. */
  rejections: RuleViolation[];
}

/**
 * What `assembleValeConfig` produced when every config passed the schema:
 * where to point `--config`, the section patterns it wrote there, and what the
 * schema noted about the configs without rejecting them.
 *
 * `sections` exists so a caller that needs to know what Vale would actually
 * lint can ask this module directly instead of re-parsing the config it just
 * wrote. Its only consumer so far, the oversized-file guard's scoped scan,
 * went with that guard (taskless/cli#351). The field stays: this module is
 * the generator, so it is the one place this fact can be stated rather than
 * re-derived, and the next reader of the sections should not have to parse
 * the file to get it.
 */
export interface AssembledValeConfig {
  status: "ok";
  /** Config path relative to the project root, for `--config`. */
  path: string;
  /**
   * Every section glob pattern written into the config, deduplicated and
   * sorted for a stable read order. Root-relative, exactly as Vale reads
   * them — the same strings a `[…]` line in a rule's own `.vale.ini` names,
   * read from the parsed structure rather than from the text.
   */
  sections: string[];
  /**
   * What the schema said about the configs without refusing them: a repeated
   * key, a `[*]` matcher, a `.taskless/**` matcher. Advisory, so the caller
   * surfaces them as notices and they never touch the exit code.
   */
  advisories: string[];
}

/**
 * What `assembleValeConfig` produced when a config was refused: nothing on
 * disk, and every rule it refused with the rejections the schema raised.
 *
 * Refusing rather than omitting the rule is the point. A rule left out of the
 * assembled config would verify, run, and report nothing, which is the silent
 * disable this engine's design exists to prevent. Refusing rather than
 * stripping the offending line is the same decision from the other side: a
 * config the schema rejects is one Vale would have read as something other
 * than what its author wrote.
 */
export interface RefusedValeConfig {
  status: "refused";
  /** Every rule refused, in id order. Never empty. */
  refusals: ValeConfigRefusal[];
}

export type ValeAssembly = AssembledValeConfig | RefusedValeConfig;

/**
 * Assemble `.taskless/.vale.ini` from every Vale rule's own config.
 *
 * Every config is validated against the config schema first. On any rejection
 * the file is not written and the refusal names each rule and line, so the
 * caller can report it as the Vale engine's failure. Otherwise the header and
 * each rule's verbatim config are written, and the result carries the config
 * path, its section patterns, and the schema's advisories.
 *
 * Returns `undefined` when no Vale rule declares any config — there is nothing
 * to run, and writing an empty config would invite Vale to lint the project
 * against no rules and report a clean pass.
 */
export async function assembleValeConfig(
  cwd: string
): Promise<ValeAssembly | undefined> {
  const ruleIds = await listRuleIds(cwd, "vale");
  const blocks: string[] = [];
  const sections = new Set<string>();
  const advisories: string[] = [];
  const refusals: ValeConfigRefusal[] = [];

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
    const verdict = validateValeRuleConfig(ruleId, source);
    if (verdict.rejections.length > 0) {
      refusals.push({ ruleId, rejections: verdict.rejections });
      continue;
    }
    for (const pattern of verdict.sections) sections.add(pattern);
    advisories.push(...verdict.advisories);
    blocks.push(valeRuleBlock(ruleId, source));
  }

  if (refusals.length > 0) return { status: "refused", refusals };
  if (blocks.length === 0) return undefined;

  const contents = [valeHeader(), ...blocks].join("\n");
  const target = join(cwd, ASSEMBLED_VALE_CONFIG);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return {
    status: "ok",
    path: ASSEMBLED_VALE_CONFIG,
    sections: [...sections].toSorted(),
    advisories,
  };
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
  /**
   * Vale's config and section patterns, the refusal that kept it unwritten,
   * or `undefined` when no Vale rule is configured.
   */
  vale: ValeAssembly | undefined;
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
  valeHeader,
  RULE_TESTS_DIRECTORY,
};
