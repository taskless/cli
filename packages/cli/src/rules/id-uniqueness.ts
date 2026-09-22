import { join } from "node:path";

import { findRuleEngines, listRuleIds, ruleDirectory } from "./engines";
import { ENGINES, type EngineName } from "./layout";

/**
 * One rule id held by more than one engine.
 *
 * A rule id is a directory name under `.taskless/rules/<engine>/`, and nothing
 * in the id contract makes it unique across the three sibling trees:
 * `isValidRuleId` is `/^[a-z0-9][a-z0-9-]*$/`, with no engine component and no
 * cross-engine check. So `.taskless/rules/sg/no-eval/` and
 * `.taskless/rules/vale/no-eval/` can both exist, and until this existed
 * nothing said so.
 */
export interface RuleIdCollision {
  ruleId: string;
  /** Every engine holding the id, in {@link ENGINES} order. Always ≥ 2. */
  engines: EngineName[];
  /** Each engine's directory for the id, in the same order. */
  paths: string[];
}

function collisionFrom(
  cwd: string,
  ruleId: string,
  engines: EngineName[]
): RuleIdCollision | undefined {
  if (engines.length < 2) return undefined;
  return {
    ruleId,
    engines,
    paths: engines.map((engine) => ruleDirectory(cwd, engine, ruleId)),
  };
}

/**
 * Whether this one id is held by more than one engine.
 *
 * Asked per rule rather than only over the whole tree, because verifying the
 * rule an author just wrote is the moment a collision is cheapest to fix. A
 * whole-project pass that only diffs the engine id lists would say nothing at
 * exactly that moment.
 */
export async function findRuleIdCollision(
  cwd: string,
  ruleId: string
): Promise<RuleIdCollision | undefined> {
  return collisionFrom(cwd, ruleId, await findRuleEngines(cwd, ruleId));
}

/**
 * Every collision in the project, in id order.
 *
 * Built from the per-engine id lists rather than by re-asking
 * {@link findRuleEngines} for each id, so the tree is enumerated once. The
 * answer is the same one {@link findRuleIdCollision} gives for each id.
 */
export async function findRuleIdCollisions(
  cwd: string
): Promise<RuleIdCollision[]> {
  const holders = new Map<string, EngineName[]>();
  for (const engine of ENGINES) {
    for (const ruleId of await listRuleIds(cwd, engine)) {
      const existing = holders.get(ruleId);
      if (existing === undefined) {
        holders.set(ruleId, [engine]);
      } else {
        existing.push(engine);
      }
    }
  }
  const collisions: RuleIdCollision[] = [];
  for (const ruleId of [...holders.keys()].toSorted((a, b) =>
    a.localeCompare(b)
  )) {
    const collision = collisionFrom(cwd, ruleId, holders.get(ruleId) ?? []);
    if (collision !== undefined) collisions.push(collision);
  }
  return collisions;
}

/** The sidecar both colliding rules write to and read from. */
export function metadataSidecarPath(cwd: string, ruleId: string): string {
  return join(cwd, ".taskless", "rule-metadata", `${ruleId}.yml`);
}

/**
 * The condition, worded the way `rules delete` already words it.
 *
 * `rules delete` refuses the same state with "Rule … is held by N engines, so
 * there is no single rule to delete: <paths>". Two surfaces describing one
 * condition in two vocabularies is how a user comes to believe they are two
 * conditions, so the opening clause is shared verbatim and only the
 * consequence differs.
 *
 * The sidecar is named because it is the damage. `writeRuleMetaFiles` keys
 * `.taskless/rule-metadata/{id}.yml` on the id alone, so the two rules share
 * one file: the second `rule create` or `rule improve` overwrites the first's
 * metadata silently, and `deleteRuleFiles` removes it for whichever rule goes
 * first. That happens whether or not anyone runs `check`.
 */
export function describeRuleIdCollision(
  cwd: string,
  collision: RuleIdCollision
): string {
  return (
    `Rule "${collision.ruleId}" is held by ${String(collision.engines.length)} engines, ` +
    `so its id does not name one rule: ${collision.paths.join(", ")}. ` +
    `They share one metadata sidecar at ${metadataSidecarPath(cwd, collision.ruleId)}, ` +
    `so whichever was written last owns it.`
  );
}
