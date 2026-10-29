import {
  ENGINE_LABELS,
  findEngineMismatches,
  findEnginesWithRules,
  type EngineMismatch,
} from "./engine-gate";
import { reconciliationStart } from "./reconcile-marker";
import { pendingRuleMigrations } from "./rule-migrate";
import type { TasklessRulesManifest } from "../filesystem/manifest";
import { compareVersions } from "../util/version-compare";

/**
 * Whether a project's rules still need `update --rules`, decided once.
 *
 * Two things can make a reconciliation due, and they move independently. The
 * ledger walk is keyed on the CLI version, compared on its numeric core, so
 * every nightly of one release reads as that release and owes no walk. The
 * engine gate is keyed on the exact engine versions, and an ast-grep or Vale
 * bump lands between two nightlies of one release as easily as between two
 * releases. Asking only the first question is how a project on nightlies was
 * told "nothing to walk" by `info` and `update` while `check` refused it with
 * `RULES_ENGINE_MISMATCH`, so the advice and the enforcement disagreed and
 * only the refusal said what to run.
 *
 * `walk` keeps its narrower meaning, the ledger sections to read. `required`
 * is the answer a caller acts on: run the `update` recipe through to its last
 * step, which applies `ruleMigrations` and records the engines.
 */
export interface ReconcileStatus {
  /**
   * Whether the `update` recipe has work to do, ending in `update --rules`.
   * While `engines` is non-empty, `check` and `verify` also refuse until then.
   */
  required: boolean;
  /** The ledger sections to read, or `null` when there are none. */
  walk: { from: string; to: string } | null;
  /**
   * Engines with rules recorded BEHIND the bundled version: what `check`
   * refuses on and `update --rules` clears. An engine recorded ahead is not
   * listed, since reconciling with an older CLI does not clear it; the
   * refusal itself names the remedy for that.
   */
  engines: EngineMismatch[];
  /** The mechanical rewrites `update --rules` applies before it stamps. */
  ruleMigrations: Array<{
    engine: string;
    engineVersion: string;
    summary: string;
  }>;
}

export async function reconcileStatus(
  cwd: string,
  rules: TasklessRulesManifest | undefined
): Promise<ReconcileStatus> {
  const walk = reconciliationStart(rules?.reconciledTo) ?? null;
  // The same comparison the gate makes, so what this reports and what `check`
  // enforces cannot drift apart.
  const engines = findEngineMismatches(
    rules?.engines,
    await findEnginesWithRules(cwd)
  ).filter(({ recorded, bundled }) => compareVersions(recorded, bundled) < 0);
  const ruleMigrations = pendingRuleMigrations(rules?.engines).map(
    ({ engine, engineVersion, summary }) => ({ engine, engineVersion, summary })
  );
  return {
    required: walk !== null || engines.length > 0,
    walk,
    engines,
    ruleMigrations,
  };
}

/**
 * The `reconcile` object every `--json` payload carries: `info` under
 * `rules`, `init` and `update` at the top level. One shape, built here, so an
 * agent reads the same path whichever command it ran. `walk` is left out
 * because each payload already reports it where it always has.
 */
export function reconcileReport(
  status: ReconcileStatus
): Omit<ReconcileStatus, "walk"> {
  return {
    required: status.required,
    engines: status.engines,
    ruleMigrations: status.ruleMigrations,
  };
}

/**
 * The line `init` prints when a reconciliation is due, or `undefined` when it
 * is not. Printed on every run that finds one due, not only on a version move:
 * an install between two nightlies, or a re-run after an upgrade nobody
 * reconciled, moves nothing and still leaves `check` refusing.
 */
export function getReconcileNotice(
  status: ReconcileStatus,
  invocation: string
): string | undefined {
  if (!status.required) return undefined;
  const reasons: string[] = [];
  if (status.walk !== null) {
    reasons.push(
      `the ledger has entries from ${status.walk.from} to ${status.walk.to}`
    );
  }
  for (const { engine, recorded, bundled } of status.engines) {
    reasons.push(
      `${ENGINE_LABELS[engine]} moved from ${recorded} to ${bundled}`
    );
  }
  const rewrites =
    status.ruleMigrations.length === 0
      ? ""
      : ` It applies ${String(status.ruleMigrations.length)} mechanical rule rewrite(s) for you.`;
  const refusal =
    status.engines.length === 0
      ? ""
      : ", so `check` and `verify` will refuse to run them until it is recorded";
  return (
    `This project's rules are not reconciled to this CLI (${reasons.join("; ")})${refusal}. ` +
    `Run \`${invocation} update\` and follow it to its last step, \`${invocation} update --rules\`.${rewrites}`
  );
}
