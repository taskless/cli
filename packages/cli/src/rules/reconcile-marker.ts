import { access } from "node:fs/promises";
import { join } from "node:path";

import { AST_GREP_VERSION, VALE_VERSION } from "./capabilities";
import { readManifest, writeManifest } from "../filesystem/migrate";
import { TASKLESS_DIRECTORY } from "./vale/formats";
import { CLIError } from "../util/cli-error";
import { getCliVersion } from "../wizard/intro";

/**
 * Recording that a project's RULES have been reconciled to a CLI version.
 *
 * Distinct from every other version in the manifest, and deliberately so.
 * `install.cliVersion` records which CLI last wrote the scaffold, and the
 * scaffold `version` records the layout schema. Both advance without anyone
 * reading a rule: a skills refresh moves the first, a layout migration moves
 * the second. Keying rule work off either would let an agent skip ledger
 * entries it never performed, and it would fail in the quiet direction, since
 * the walk would report nothing to do while the rules stayed wrong.
 */

/** What a completed reconciliation records. */
export interface ReconcileResult {
  reconciledTo: string;
  engines: { sg: string; vale: string };
  /** The value replaced, or `undefined` on a project that had never recorded one. */
  previous: string | undefined;
}

/**
 * Compare two dotted version strings numerically, ignoring any prerelease
 * suffix.
 *
 * A nightly is `0.11.0-20260826062304x3c78ffe`, so a plain string comparison
 * would sort it after `0.11.0` and let a nightly-built project refuse a
 * release-built one. Only the numeric core is compared, which makes a nightly
 * and its release equal for this purpose. That is the right answer: they carry
 * the same ledger entries.
 */
function versionCore(version: string): number[] {
  return (version.split("-")[0] ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const left = versionCore(a);
  const right = versionCore(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Record that the ledger walk completed up to `reconciledTo`.
 *
 * The version is validated rather than trusted. An agent supplies it, and an
 * agent can be wrong: the two ways it can be wrong are claiming a version this
 * CLI does not have entries for, and moving the marker backwards. Both are
 * rejected here rather than written and puzzled over later.
 */
/**
 * A dotted numeric version, with an optional prerelease suffix.
 *
 * Checked BEFORE either comparison, because `versionCore` coerces an
 * unparseable segment to `0`: without this, `abc` parses as `[0]`, compares
 * lower than any real version, sails past both guards, and is written to the
 * manifest verbatim. A pasted SHA or a truncated interpolation would corrupt
 * the marker with nothing reported, which is the opposite of the validation
 * this function exists to do.
 */
/**
 * What a project with no recorded marker counts as.
 *
 * Not "current": a project that predates the ledger has had none of its
 * entries applied, and reading absence as up-to-date would silently excuse it
 * from all of them.
 */
export const BASELINE_VERSION = "0.0.0";

export async function recordReconciliation(
  cwd: string
): Promise<ReconcileResult> {
  // Stamped from the running CLI, never supplied by the caller.
  //
  // An agent has nothing to contribute here: the only sensible endpoint of a
  // walk is the installed version, and letting a value in only made it
  // possible to claim a walk that did not finish, which this design forbids
  // anyway. Removing the parameter removes the two guards that existed to
  // police it, along with every way of getting it wrong.
  const reconciledTo = getCliVersion();

  const tasklessDirectory = join(cwd, TASKLESS_DIRECTORY);

  // Checked, not created. `readManifest` tolerates a missing file, but
  // `writeManifest` writes directly and does not make parent directories, so
  // without this the command dies on a raw ENOENT reported as INTERNAL_ERROR.
  //
  // Creating the directory would be worse than failing: it would record a
  // reconciliation for a project that has no rules to reconcile, which is the
  // marker claiming work that could not have happened. The recipe already
  // states this precondition; this is the code holding to it.
  if (!(await pathExists(tasklessDirectory))) {
    throw new CLIError(
      `No \`${TASKLESS_DIRECTORY}/\` in this project, so there are no rules to reconcile. Run the CLI once to set it up before recording a reconciliation.`,
      "INVALID_INPUT"
    );
  }

  const { manifest, raw } = await readManifest(tasklessDirectory);
  const previous = manifest.rules?.reconciledTo;

  // Still guarded, because the stamp comes from whichever CLI is running: an
  // older one on the same project would otherwise rewind the marker and send
  // the next walk back through entries already applied.
  if (previous !== undefined && compareVersions(reconciledTo, previous) < 0) {
    throw new CLIError(
      `This CLI is ${reconciledTo} and the project is already reconciled to ${previous}. Ledger entries are cumulative and a walk only moves forward, so recording an older CLI would claim work was undone. Upgrade before reconciling.`,
      "INVALID_INPUT"
    );
  }

  const rules = {
    ...manifest.rules,
    reconciledTo,
    // The engines the rules are now valid against. Recorded here and nowhere
    // else, so an upgrade cannot silently refresh them.
    engines: { sg: AST_GREP_VERSION, vale: VALE_VERSION },
  };

  await writeManifest(tasklessDirectory, { ...manifest, rules }, raw);

  return { reconciledTo, engines: rules.engines, previous };
}

/**
 * Where a ledger walk should start, or `undefined` when there is nothing to
 * walk.
 *
 * A project with no marker has never recorded a reconciliation. That is NOT
 * the same as being behind: a project created at the installed version has no
 * history, and telling its author to walk every entry ever written would be
 * noise. Callers record the current version and do nothing, rather than
 * backfilling a claim nobody earned.
 */
export function reconciliationStart(
  recorded: string | undefined
): { from: string; to: string } | undefined {
  const installed = getCliVersion();
  // A missing marker means the project PREDATES the marker, so every entry
  // still applies and the walk starts from the beginning. `init` stamps the
  // field on a genuinely new project, which is what makes the two
  // distinguishable: absent is old, present is accounted for. Treating absent
  // as "nothing to do" would have quietly excused every project that existed
  // before this feature from the entries written for it.
  const from = recorded ?? BASELINE_VERSION;
  if (compareVersions(from, installed) >= 0) return undefined;
  return { from, to: installed };
}

/** Whether a path exists, without distinguishing why it does not. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stamp the rules marker on a project being set up by this CLI.
 *
 * A new project has no ledger entries to walk: everything the entries describe
 * is already true of a scaffold this CLI just wrote. Recording that up front
 * is what gives an ABSENT marker its meaning, which is "this project predates
 * the ledger and has had none of it applied".
 *
 * ONLY call this when the project was genuinely new, which the caller has to
 * establish BEFORE creating the directory. This function cannot tell: by the
 * time it runs, `ensureTasklessDirectory` has already `mkdir -p`'d, so a
 * pre-existing project and a fresh one look identical. Stamping one that
 * merely never recorded a marker would mark it fully reconciled and skip every
 * entry, which is the exact silent-skip this whole feature exists to prevent,
 * reachable by re-running setup on an ordinary older project.
 *
 * Never overwrites either. Re-running setup on a project that HAS a marker
 * must not reset one a real walk earned.
 */
export async function stampNewProjectRules(cwd: string): Promise<void> {
  const tasklessDirectory = join(cwd, TASKLESS_DIRECTORY);
  try {
    const { manifest, raw } = await readManifest(tasklessDirectory);
    if (manifest.rules?.reconciledTo !== undefined) return;
    await writeManifest(
      tasklessDirectory,
      {
        ...manifest,
        rules: {
          ...manifest.rules,
          reconciledTo: getCliVersion(),
          engines: { sg: AST_GREP_VERSION, vale: VALE_VERSION },
        },
      },
      raw
    );
  } catch {
    // Setting up a project must not fail because a marker could not be
    // written. The cost of missing it is one extra ledger walk, which is the
    // safe direction to be wrong in.
  }
}
