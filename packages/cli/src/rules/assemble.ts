import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";

import {
  ASSEMBLED_SG_CONFIG,
  ASSEMBLED_SG_RULES,
  ASSEMBLED_VALE_CONFIG,
  listRuleIds,
  ruleConfigPath,
  ruleFilePath,
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

/** Whether `path` is a regular file on disk. */
async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
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
 * A rule's assembled block: its breadcrumb comment, then its config verbatim
 * except that each breadcrumb is commented out.
 *
 * The config is the generator's structured input and is never re-serialized.
 * The schema has already read it as an AST, for validation and for the matcher
 * list; what Vale reads is the file's own bytes, so matcher order, comments and
 * spacing survive exactly as the author wrote them. Matcher order inside a rule
 * is the author's expression of precedence, so anything short of verbatim
 * would be a semantic edit. The one addition is a newline after a source that
 * lacks one, so the next rule's breadcrumb starts its own line.
 *
 * The one edit is `# ` in front of each `tskl) rule` line, at the lines the
 * schema located (`breadcrumbLines`), so nothing here searches the text for
 * it. That is not a semantic edit: Vale read the key as a rule named
 * `tskl) rule` switched off, which is nothing. What changed in 3.24.0 is that
 * it says so, `W101 'tskl) rule' isn't a section option`, once per matcher on
 * every run, and that line on stderr in front of a real error's JSON is what
 * kept a file Vale cannot parse from being narrowed out of the run
 * (taskless/cli#300). Commenting rather than deleting keeps every line where
 * the author put it, so a line number Vale reports is still the author's.
 *
 * This is also why the schema, not this module, turns away a copied-in
 * `StylesPath` or `MinAlertLevel`. Assembly used to strip those two by
 * splitting each line on `=`; that was the one string edit it performed, and
 * it meant the file Vale read was not the file the author wrote. A run-level
 * key above the first matcher is now a rejection, so there is nothing left to
 * strip.
 */
function valeRuleBlock(
  ruleId: string,
  source: string,
  breadcrumbLines: readonly number[]
): string {
  const lines = source.split("\n");
  for (const line of breadcrumbLines) {
    lines[line - 1] = `# ${lines[line - 1] ?? ""}`;
  }
  const commented = lines.join("\n");
  const terminated = commented.endsWith("\n") ? commented : `${commented}\n`;
  return `# tskl) rule = ${ruleId}\n${terminated}`;
}

/** One rule whose config the schema refused. */
export interface ValeConfigRefusal {
  ruleId: string;
  /** Every rejection, each naming the line and the constraint it broke. */
  rejections: RuleViolation[];
}

/**
 * A Vale config enabling one rule under its own matchers, and nothing else.
 *
 * What `verify` runs a Vale case under: the rule's `.vale.ini`, block for
 * block what `check` assembles for it, behind a header whose `StylesPath` is
 * absolute because the config is written outside the project. Not
 * `assembleValeConfig({ ruleIds })`, which validates every rule and refuses
 * the whole assembly on any rejection, deliberately, so `check --rule` cannot
 * report findings an unfiltered `check` never would. Under `verify` that
 * would let another rule's broken config fail this rule's cases.
 *
 * `undefined` when the schema rejects the config, which `validate` reports
 * before `verify` ever gets here.
 */
export function buildOneRuleValeConfig(
  stylesPath: string,
  ruleId: string,
  source: string
): string | undefined {
  const verdict = validateValeRuleConfig(ruleId, source);
  if (verdict.rejections.length > 0) return undefined;
  return [
    `StylesPath = ${toPosix(stylesPath)}`,
    "MinAlertLevel = suggestion",
    "",
    valeRuleBlock(ruleId, source, verdict.breadcrumbLines),
  ].join("\n");
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

/** Narrowing shared by the engine assemblers. */
export interface AssembleOptions {
  /**
   * Restrict assembly to these rule ids — `check --rule`. `undefined` is the
   * ordinary whole-project run and means every rule; an empty array means no
   * rule was selected for this engine, so it assembles nothing and the engine
   * is skipped.
   *
   * Narrowing Vale by REMOVING the other rules' blocks, rather than by writing
   * a config that enables one rule under `[*]`, is what makes a filtered run
   * report what an unfiltered run would have reported for that rule. Each rule
   * keeps its own matchers verbatim, so its scope is unchanged, and the schema
   * refuses a config that assigns another rule's key (the "names another rule"
   * rejection in `schemas/vale-config.ts`), so no removed block could have been
   * setting the selected rule's `<id>.<id>` value. Vale's positional precedence
   * therefore has nothing left to act on across rules, and the surviving block
   * resolves exactly as it did among the others.
   *
   * **This narrows what is WRITTEN, never what is VALIDATED.** Every Vale rule
   * in the project is still read and put through the config schema, and any
   * rejection still refuses the whole assembly. Skipping an unselected rule's
   * validation would make `--rule good` exit clean in a project where `bad`'s
   * config is rejected, while an unfiltered `check` in that same project
   * refuses the Vale engine outright — so the filtered run would report
   * findings the unfiltered run never produced, which is the one equality this
   * flag exists to preserve.
   */
  ruleIds?: readonly string[];
}

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
  cwd: string,
  options: AssembleOptions = {}
): Promise<ValeAssembly | undefined> {
  const ruleIds = await listRuleIds(cwd, "vale");
  // A filter selects which validated blocks are written, and is deliberately
  // NOT applied to `ruleIds`: the loop below has to reach every rule so a
  // rejected sibling still lands in `refusals`.
  const selected =
    options.ruleIds === undefined ? undefined : new Set(options.ruleIds);
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
      // `validate` reports it.
      continue;
    }
    const verdict = validateValeRuleConfig(ruleId, source);
    if (verdict.rejections.length > 0) {
      refusals.push({ ruleId, rejections: verdict.rejections });
      continue;
    }
    // Validated above, filtered here. Its sections and advisories are dropped
    // with its block, because they describe a rule this run does not run.
    if (selected !== undefined && !selected.has(ruleId)) continue;
    for (const pattern of verdict.sections) sections.add(pattern);
    advisories.push(...verdict.advisories);
    blocks.push(valeRuleBlock(ruleId, source, verdict.breadcrumbLines));
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
 * Assemble `.taskless/.sgconfig.yml`, over a rules-only copy of the tree.
 *
 * ast-grep walks `ruleDirs` recursively and parses every `.yml` it reaches as
 * a rule, so it is never pointed at `.taskless/rules/sg/` itself: a rule's
 * `tests/` holds fixture files, and the first `.yml` fixture would fail the
 * whole scan with `Cannot parse rule`. Measured on 0.51.0. Each rule's
 * `<id>.yml` is copied into `.taskless/.sg-rules/` instead, and that is what
 * `ruleDirs` names, so what a rule directory may contain is the CLI's
 * business rather than a property of ast-grep's discovery.
 *
 * Copied rather than linked: symlinks need privileges on Windows, and a rule
 * file is a few hundred bytes. The tree is cleared first, so a rule deleted
 * since the last run cannot keep reporting from a stale copy. `check`, the one
 * caller, assembles against its snapshot, so the tree lands inside the run
 * directory and never in the project.
 *
 * No `testConfigs`: `verify` writes its own one-rule config for `sg test`.
 */
export async function assembleSgConfig(
  cwd: string
): Promise<string | undefined> {
  const ruleIds = await listRuleIds(cwd, "sg");
  if (ruleIds.length === 0) return undefined;

  const tree = join(cwd, ASSEMBLED_SG_RULES);
  await rm(tree, { recursive: true, force: true });
  await mkdir(tree, { recursive: true });
  await Promise.all(
    ruleIds.map(async (ruleId) => {
      const source = ruleFilePath(cwd, "sg", ruleId);
      if (!(await isFile(source))) return;
      await copyFile(source, join(tree, basename(source)));
    })
  );

  const contents = [
    "ruleDirs:",
    `  - ${toPosix(relative(dirname(join(cwd, ASSEMBLED_SG_CONFIG)), tree))}`,
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
  cwd: string,
  options: AssembleOptions = {}
): Promise<AssembledConfigs> {
  const [vale, sg] = await Promise.all([
    assembleValeConfig(cwd, options),
    assembleSgConfig(cwd),
  ]);
  return { vale, sg };
}

/** Exported for the assembly tests, which assert on the artifact directly. */
export const ASSEMBLY_INTERNALS = {
  valeHeader,
  RULE_TESTS_DIRECTORY,
};
