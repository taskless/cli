import { join } from "node:path";

import {
  BUNDLED,
  ENGINE_LABELS,
  findEngineMismatches,
  findEnginesWithRules,
  isRecordedAhead,
  type EngineMismatch,
  type GatedEngine,
} from "./engine-versions";
import { TASKLESS_DIRECTORY } from "./layout";
import type { PlatformBinaryResolution } from "./platform-binary";
import { resolveSgBinary } from "./scan";
import { findValeBinary } from "./vale/binary";
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

/** An engine binary from outside the pinned package, at another version. */
export interface BinaryMismatch {
  engine: GatedEngine;
  path: string;
  source: "node_modules/.bin" | "PATH";
  /** The version it printed, or `undefined` when none could be read. */
  reported: string | undefined;
  bundled: string;
}

/** The first `x.y.z` in a binary's `--version` output. */
export function reportedVersion(output: string): string | undefined {
  return /\d+\.\d+\.\d+/.exec(output)?.[0];
}

/**
 * The resolved engine binaries that are not the version this CLI bundles.
 *
 * Only a binary from outside the platform package is compared. The platform
 * package is the pinned install, so its version is the bundled one by
 * construction (`engine-version-consistency.test.ts` holds that link). A
 * fallback binary from `node_modules/.bin` or `PATH` can be any version, and
 * running one of another version is exactly what the recorded-engines gate
 * exists to prevent: a rule written for one engine version can fail to load
 * on another (#650). An engine with nothing resolved is left to its own
 * not-found handling.
 */
export function findBinaryMismatches(
  resolutions: Partial<Record<GatedEngine, PlatformBinaryResolution>>,
  bundled: Record<GatedEngine, string> = BUNDLED
): BinaryMismatch[] {
  const mismatches: BinaryMismatch[] = [];
  for (const engine of Object.keys(ENGINE_LABELS) as GatedEngine[]) {
    const resolution = resolutions[engine];
    if (resolution?.path === undefined) continue;
    if (
      resolution.source === undefined ||
      resolution.source === "platform-package"
    ) {
      continue;
    }
    const reported = reportedVersion(resolution.versionOutput ?? "");
    if (reported === bundled[engine]) continue;
    mismatches.push({
      engine,
      path: resolution.path,
      source: resolution.source,
      reported,
      bundled: bundled[engine],
    });
  }
  return mismatches;
}

/** The refusal's text: which binary, which version, and the way through. */
export function binaryMismatchMessage(mismatches: BinaryMismatch[]): string {
  const listed = mismatches
    .map(
      ({ engine, path, source, reported, bundled }) =>
        `${ENGINE_LABELS[engine]} at ${path} (found in ${source}) reports ${
          reported === undefined ? "no version this CLI can read" : reported
        }, and this CLI bundles ${bundled}`
    )
    .join("; ");
  return [
    `The pinned engine package is not installed, and the binary found instead is another version: ${listed}. A rule written for one engine version can fail to load on another, so the rules are not run.`,
    "",
    "Reinstall the CLI so its platform package for this host is present, or put the bundled version first on PATH.",
    "",
    "Pass --allow-version-mismatches to run this binary anyway, knowing some rules may not load.",
  ].join("\n");
}

/**
 * Throw `RULES_ENGINE_MISMATCH` when the rules were reconciled against an
 * engine version this CLI does not bundle, and `ENGINE_BINARY_MISMATCH` when
 * the binary that would run is not that version. A manifest that cannot be
 * read is left to `ensureSchema`, which callers run first.
 */
export async function requireReconciledEngines(cwd: string): Promise<void> {
  if (hasVersionMismatchOverride()) return;
  const enginesWithRules = await findEnginesWithRules(cwd);

  let recorded: unknown;
  try {
    const { manifest } = await readManifest(join(cwd, TASKLESS_DIRECTORY));
    recorded = manifest.rules?.engines;
  } catch {
    // Unreadable is `ensureSchema`'s to report; the binary is still checked.
    recorded = undefined;
  }
  const mismatches =
    recorded === undefined
      ? []
      : findEngineMismatches(recorded, enginesWithRules);
  if (mismatches.length > 0) {
    throw new CLIError(
      engineMismatchMessage(mismatches, getCliPrefix()),
      "RULES_ENGINE_MISMATCH"
    );
  }

  // Resolved only for an engine with rules: resolution spawns each
  // candidate, and an engine that will not run has nothing to refuse.
  const binaries = findBinaryMismatches({
    ...(enginesWithRules.has("sg") ? { sg: resolveSgBinary() } : {}),
    ...(enginesWithRules.has("vale") ? { vale: findValeBinary() } : {}),
  });
  if (binaries.length > 0) {
    throw new CLIError(
      binaryMismatchMessage(binaries),
      "ENGINE_BINARY_MISMATCH"
    );
  }
}
