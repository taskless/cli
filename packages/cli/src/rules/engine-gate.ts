import { join } from "node:path";

import {
  ENGINE_LABELS,
  findEngineMismatches,
  findEnginesWithRules,
  isRecordedAhead,
  type EngineMismatch,
} from "./engine-versions";
import { TASKLESS_DIRECTORY } from "./layout";
import { readManifest } from "../filesystem/manifest";
import { hasVersionMismatchOverride } from "../filesystem/migrate";
import { CLIError } from "../util/cli-error";
import { getCliPrefix } from "../util/package-manager";

/**
 * Refusing to run rules reconciled against other engine versions.
 *
 * `rules.engines` is written by `update --rules` and nowhere else, so it is an
 * honest record of the ast-grep and Vale the rules were last made valid for.
 * An engine upgrade can rename a kind or retire a key, and a rule still in the
 * old shape can take every other rule of that engine down with it. Rule
 * migrations fix that, but only when `update --rules` runs them, and `check`
 * never writes to the rules tree. So `check` and `verify` refuse instead, and
 * name the command that reconciles.
 *
 * Separate from `ensureSchema`, because `update --rules` calls that and
 * must not be refused by the gate it exists to clear.
 */

/** The refusal's text: what differs, and the remedy for each direction. */
export function engineMismatchMessage(
  mismatches: EngineMismatch[],
  prefix: string
): string {
  const behind = mismatches.filter((mismatch) => !isRecordedAhead(mismatch));
  const listed = mismatches
    .map(
      ({ engine, recorded, bundled }) =>
        `${ENGINE_LABELS[engine]} ${recorded} (this CLI bundles ${bundled})`
    )
    .join(" and ");
  const lines = [
    `This project's rules were reconciled against ${listed}, as recorded in .taskless/taskless.json. A rule written for one engine version can fail to load on another, so they are not run.`,
    "",
  ];
  if (behind.length === mismatches.length) {
    lines.push(
      `Run \`${prefix} update\` and follow what it says changed, then \`${prefix} update --rules\`, which applies any rule rewrites and records the engines this CLI bundles.`
    );
  } else {
    lines.push(
      "The rules were reconciled by a newer CLI than this one. Run the CLI the project records, such as its launcher under .taskless/bin/."
    );
  }
  lines.push(
    "",
    "Pass --allow-version-mismatches to run anyway, knowing some rules may not load."
  );
  return lines.join("\n");
}

/**
 * Throw `RULES_ENGINE_MISMATCH` when the rules were reconciled against an
 * engine version this CLI does not bundle. A manifest that cannot be read is
 * left to `ensureSchema`, which callers run first.
 */
export async function requireReconciledEngines(cwd: string): Promise<void> {
  if (hasVersionMismatchOverride()) return;
  let recorded: unknown;
  try {
    const { manifest } = await readManifest(join(cwd, TASKLESS_DIRECTORY));
    recorded = manifest.rules?.engines;
  } catch {
    return;
  }
  if (recorded === undefined) return;

  const mismatches = findEngineMismatches(
    recorded,
    await findEnginesWithRules(cwd)
  );
  if (mismatches.length === 0) return;
  throw new CLIError(
    engineMismatchMessage(mismatches, getCliPrefix()),
    "RULES_ENGINE_MISMATCH"
  );
}
