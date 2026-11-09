import { AST_GREP_VERSION, VALE_VERSION } from "./capabilities";
import { listRuleIds } from "./engines";
import { compareVersions } from "../util/version-compare";

/**
 * Comparing the engine versions a project's rules were reconciled against
 * with the ones this CLI bundles.
 *
 * Kept apart from `engine-gate.ts`, which refuses on the result, because the
 * marker that records these versions needs the same comparison and the gate
 * reaches `filesystem/migrate`, whose migrations import the marker. Importing
 * the gate from the marker closed that loop and left the migration registry
 * holding `undefined` (see `migration-registry.test.ts`).
 */

export const ENGINE_LABELS = { sg: "ast-grep", vale: "Vale" } as const;

export type GatedEngine = keyof typeof ENGINE_LABELS;

export const BUNDLED: Record<GatedEngine, string> = {
  sg: AST_GREP_VERSION,
  vale: VALE_VERSION,
};

/** One engine whose recorded version is not the bundled one. */
export interface EngineMismatch {
  engine: GatedEngine;
  recorded: string;
  bundled: string;
}

/**
 * The engines to refuse on. Only an engine that is recorded AND has rules is
 * compared: a project that never reconciled has no claim to check, and an
 * engine with no rules has nothing that could run wrongly. Without the second
 * condition a Vale upgrade would block every ast-grep-only project until it
 * walked a ledger with nothing in it.
 *
 * Any difference counts. A patch-level engine release can move matching as
 * easily as a minor one, which is why the reconciliation records exact
 * versions.
 */
export function findEngineMismatches(
  recorded: unknown,
  enginesWithRules: ReadonlySet<GatedEngine>,
  bundled: Record<GatedEngine, string> = BUNDLED
): EngineMismatch[] {
  if (typeof recorded !== "object" || recorded === null) return [];
  const mismatches: EngineMismatch[] = [];
  for (const engine of Object.keys(ENGINE_LABELS) as GatedEngine[]) {
    const version = (recorded as Record<string, unknown>)[engine];
    if (typeof version !== "string" || !enginesWithRules.has(engine)) continue;
    if (version !== bundled[engine]) {
      mismatches.push({ engine, recorded: version, bundled: bundled[engine] });
    }
  }
  return mismatches;
}

/**
 * Whether a mismatch is the "newer CLI" kind: anything not recorded behind the
 * bundled engine. The one definition the refusal text, `reconcileStatus` and
 * `update --rules` all use, so they cannot disagree about which engines a newer
 * CLI reconciled.
 */
export function isRecordedAhead({
  recorded,
  bundled,
}: EngineMismatch): boolean {
  return compareVersions(recorded, bundled) >= 0;
}

/**
 * The engines with rules that a newer CLI reconciled: what `check` refuses on
 * and an older CLI must not stamp over. Filtered by `enginesWithRules` exactly
 * as the gate is, so an engine whose rules are gone does not hold anything up.
 */
export async function findEnginesAhead(
  cwd: string,
  recorded: unknown
): Promise<EngineMismatch[]> {
  return findEngineMismatches(recorded, await findEnginesWithRules(cwd)).filter(
    (mismatch) => isRecordedAhead(mismatch)
  );
}

/** The gated engines that have at least one rule in this project. */
export async function findEnginesWithRules(
  cwd: string
): Promise<Set<GatedEngine>> {
  const engines = new Set<GatedEngine>();
  for (const engine of Object.keys(ENGINE_LABELS) as GatedEngine[]) {
    const ids = await listRuleIds(cwd, engine);
    if (ids.length > 0) engines.add(engine);
  }
  return engines;
}
