import { CLIError } from "../util/cli-error";
import { findRuleEngines } from "./engines";
import { RULES_DIRECTORY, type EngineName } from "./layout";

/**
 * Which rules a run is restricted to, split by the engine that owns each one.
 *
 * Split rather than kept as one list because the two static engines narrow by
 * different mechanisms — ast-grep by `--filter` over the ids it loaded, Vale by
 * assembling a config that contains only the selected rules — and each has to
 * be handed only the ids it can act on. An engine whose list is empty has no
 * work in this run and is skipped outright, which is not the same as being
 * handed a filter that matches nothing: the second one still spawns.
 */
export interface RuleSelection {
  sg: string[];
  vale: string[];
  runtime: string[];
}

/**
 * Resolve `--rule` ids into the per-engine selection a run is restricted to.
 *
 * Every id has to name a rule directory on disk. An id that names none is a
 * refusal rather than an empty run: the whole point of the flag is to measure
 * one rule over the project, and a typo that silently measures nothing reports
 * "0 findings", which is also what a clean rule reports. The two are the answers
 * an author is choosing between, so they must never look alike.
 *
 * An id held by more than one engine selects **both**. That is deliberately
 * unlike `rules delete`, which refuses an ambiguous id (`RULE_ID_AMBIGUOUS`):
 * deleting is destructive and irreversible, so guessing which rule the caller
 * meant is unacceptable, while measuring is neither. `check` with no filter
 * would have run both of them, and `--rule` narrows a run rather than
 * redefining it, so both still run and the findings carry the engine in their
 * `source` field.
 *
 * Reads directory names, not the `id:` inside a rule file. The directory name
 * IS the rule id here (`rules/constraints.ts`, `rules/verify.ts` both state and
 * enforce it), so this is the same identity `test` and `rules delete` address a
 * rule by, and a rule whose file disagrees with its directory is already a
 * `verify` failure rather than something for this to guess at.
 */
export async function resolveRuleSelection(
  cwd: string,
  requested: readonly string[]
): Promise<RuleSelection> {
  // Deduplicated, because `--rule a --rule a` is one rule, and an id repeated
  // into the ast-grep filter alternation or the Vale assembly would otherwise
  // be a rule listed twice. Insertion order is kept so the unknown-id message
  // reads back in the order the ids were typed.
  const unique = [...new Set(requested)];

  // `findRuleEngines` is the one implementation of "which engines hold this
  // id", shared with `rules delete` and `test`. A second copy here — listing
  // every engine's directory and matching names — would be a second definition
  // of rule identity, and a later change to one (case-insensitive ids, a new
  // engine) would silently diverge from the other.
  const holders = new Map<string, EngineName[]>();
  await Promise.all(
    unique.map(async (id) => {
      holders.set(id, await findRuleEngines(cwd, id));
    })
  );

  const unknown = unique.filter((id) => holders.get(id)!.length === 0);
  if (unknown.length > 0) {
    throw new CLIError(
      `No rule named ${unknown.map((id) => `"${id}"`).join(", ")} under ` +
        `.taskless/${RULES_DIRECTORY}/. A rule id is the name of its directory ` +
        `under .taskless/${RULES_DIRECTORY}/<engine>/.`,
      "RULE_NOT_FOUND"
    );
  }

  const selection: RuleSelection = { sg: [], vale: [], runtime: [] };
  for (const id of unique) {
    for (const engine of holders.get(id)!) selection[engine].push(id);
  }
  return selection;
}
