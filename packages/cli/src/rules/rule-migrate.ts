import { join } from "node:path";

import { AST_GREP_VERSION, VALE_VERSION } from "./capabilities";
import haskellTypeSynonym from "./rule-migrations/sg-0-50-0-haskell-type-synonym";
import { compareVersions } from "../util/version-compare";

/**
 * Mechanical rewrites of rule CONTENT, applied when a project's rules cross an
 * engine version.
 *
 * Not scaffold migrations, and deliberately keyed on a different version.
 * The scaffold `version` records the LAYOUT, and every bump of it makes a
 * pinned older CLI refuse the project with `SCAFFOLD_VERSION_MISMATCH`. An
 * engine upgrade that renames a kind or retires a key touches the few projects
 * with a rule in that shape, so spending a scaffold bump on it would break
 * every pinned CI for a change almost none of them need. These are keyed on
 * `rules.engines` instead: the engine versions the rules were last reconciled
 * against, recorded by `update --rules` and nowhere else.
 *
 * `update --rules` applies them, after the ledger walk and before it stamps
 * the marker, so the marker never records an engine whose rewrites did not
 * run. Each migration runs when the recorded engine version is below its
 * `engineVersion` and the bundled engine is at or above it.
 *
 * A migration MUST:
 *
 * - be idempotent, and leave a file it has nothing to do in untouched, so a
 *   rerun after a partial failure (nothing is stamped then) changes nothing
 *   already done and `git status` stays clean on a project it does not apply
 *   to;
 * - edit bytes in place rather than parse and re-serialize, so every comment
 *   and blank line stays where the author put it;
 * - rewrite only shapes the Taskless service has not issued, or has already
 *   migrated in its own corpus. An issued rule is checked against the bytes
 *   the service recorded, and accepting any other bytes client-side would be a
 *   signature bypass. A rewritten issued rule reads as "edited since Taskless
 *   issued it", and `rule restore` then writes the old shape straight back.
 */
export type RuleEngine = "sg" | "vale";

export interface RuleMigration {
  engine: RuleEngine;
  /** The first engine version on which the rewritten shape is required. */
  engineVersion: string;
  /** One line saying what changes, as `update --rules` reports it. */
  summary: string;
  /**
   * Rewrite the rules under `engineDirectory` (`.taskless/rules/<engine>`),
   * returning each file written, relative to that directory.
   */
  apply: (engineDirectory: string) => Promise<string[]>;
}

/** What one applied migration reports: its identity and the files it wrote. */
export interface AppliedRuleMigration {
  engine: RuleEngine;
  engineVersion: string;
  summary: string;
  /** Written files, relative to the project root. */
  files: string[];
}

const RULE_MIGRATIONS: readonly RuleMigration[] = [haskellTypeSynonym];

const BUNDLED: Record<RuleEngine, string> = {
  sg: AST_GREP_VERSION,
  vale: VALE_VERSION,
};

/**
 * A rules block that never recorded an engine predates the marker, so it has
 * had none of these applied. The same reading `BASELINE_VERSION` gives an
 * absent `reconciledTo`; restated rather than imported, because
 * `reconcile-marker` imports this module.
 */
const UNRECORDED = "0.0.0";

/** The migrations a project with `recorded` engines still needs, in order. */
export function pendingRuleMigrations(
  recorded: Partial<Record<RuleEngine, string>> | undefined,
  migrations: readonly RuleMigration[] = RULE_MIGRATIONS
): RuleMigration[] {
  return migrations
    .filter(
      (migration) =>
        compareVersions(
          recorded?.[migration.engine] ?? UNRECORDED,
          migration.engineVersion
        ) < 0 &&
        compareVersions(migration.engineVersion, BUNDLED[migration.engine]) <= 0
    )
    .toSorted(
      (a, b) =>
        a.engine.localeCompare(b.engine) ||
        compareVersions(a.engineVersion, b.engineVersion)
    );
}

/**
 * Apply every pending migration under `tasklessDirectory`, in order.
 *
 * Every migration is reported, including one that wrote nothing, so the
 * output says what was checked and not only what changed.
 */
export async function applyRuleMigrations(
  tasklessDirectory: string,
  recorded: Partial<Record<RuleEngine, string>> | undefined,
  migrations: readonly RuleMigration[] = RULE_MIGRATIONS
): Promise<AppliedRuleMigration[]> {
  const applied: AppliedRuleMigration[] = [];
  for (const migration of pendingRuleMigrations(recorded, migrations)) {
    const engineDirectory = join(tasklessDirectory, "rules", migration.engine);
    const written = await migration.apply(engineDirectory);
    applied.push({
      engine: migration.engine,
      engineVersion: migration.engineVersion,
      summary: migration.summary,
      files: written.map((file) =>
        join(".taskless", "rules", migration.engine, file)
      ),
    });
  }
  return applied;
}
