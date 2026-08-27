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
const VERSION_SHAPE = /^\d+(?:\.\d+)*(?:-[\w.]+)?$/;

export async function recordReconciliation(
  cwd: string,
  reconciledTo: string
): Promise<ReconcileResult> {
  if (!VERSION_SHAPE.test(reconciledTo)) {
    throw new CLIError(
      `"${reconciledTo}" is not a version. Pass the CLI version the ledger walk completed up to, such as the \`version\` reported by \`info --json\`.`,
      "INVALID_INPUT"
    );
  }

  const installed = getCliVersion();

  if (compareVersions(reconciledTo, installed) > 0) {
    throw new CLIError(
      `Cannot record reconciliation to ${reconciledTo}: this CLI is ${installed}, so it carries no ledger entries for that version. Upgrade first, then reconcile.`,
      "INVALID_INPUT"
    );
  }

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

  if (previous !== undefined && compareVersions(reconciledTo, previous) < 0) {
    throw new CLIError(
      `Cannot record reconciliation to ${reconciledTo}: the project is already reconciled to ${previous}. Ledger entries are cumulative and a walk only moves forward; recording an earlier version would claim work was undone.`,
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
  if (recorded === undefined) return undefined;
  if (compareVersions(recorded, installed) >= 0) return undefined;
  return { from: recorded, to: installed };
}

/** Whether a path exists, without distinguishing why it does not. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
