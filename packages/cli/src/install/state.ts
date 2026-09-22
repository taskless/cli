import { join } from "node:path";

import type {
  TasklessInstallManifest,
  TasklessInstallTarget,
} from "../filesystem/manifest";
import { readManifest, writeManifest } from "../filesystem/manifest";

const TASKLESS_DIR = ".taskless";

/**
 * How a target holds its content. A `canonical` target stores the full
 * skill/command files; a `reference` target stores thin stubs that delegate
 * to the canonical store.
 */
export type InstallMode = "canonical" | "reference";

export interface InstallTargetRecord {
  skills: string[];
  commands: string[];
  /**
   * Install mode for this target. Optional on in-memory records and absent
   * in manifests written before this field existed — {@link readInstallState}
   * normalizes a missing value to `canonical`.
   */
  mode?: InstallMode;
}

export interface InstallState {
  cliVersion?: string;
  targets: Record<string, InstallTargetRecord>;
}

export interface InstallDiffEntry {
  target: string;
  /**
   * Effective install mode for this target: the next state's mode when the
   * target survives, otherwise the previous state's mode, defaulting to
   * `canonical`. Lets removal logic respect a target's mode without a second
   * state lookup.
   */
  mode: InstallMode;
  additions: { skills: string[]; commands: string[] };
  removals: { skills: string[]; commands: string[] };
  unchanged: { skills: string[]; commands: string[] };
}

export interface InstallDiff {
  entries: InstallDiffEntry[];
  hasRemovals: boolean;
  hasAdditions: boolean;
}

function toInstallState(
  install: TasklessInstallManifest | undefined
): InstallState {
  const targets: Record<string, InstallTargetRecord> = {};
  if (install?.targets) {
    for (const [name, t] of Object.entries(install.targets)) {
      targets[name] = {
        skills: t.skills ?? [],
        commands: t.commands ?? [],
        // A manifest written before `mode` existed is treated as canonical.
        mode: t.mode ?? "canonical",
      };
    }
  }
  return {
    cliVersion: install?.cliVersion,
    targets,
  };
}

function toInstallManifest(state: InstallState): TasklessInstallManifest {
  const targets: Record<string, TasklessInstallTarget> = {};
  for (const [name, t] of Object.entries(state.targets)) {
    const entry: TasklessInstallTarget = {};
    if (t.skills.length > 0) entry.skills = [...t.skills];
    if (t.commands.length > 0) entry.commands = [...t.commands];
    if (t.mode) entry.mode = t.mode;
    targets[name] = entry;
  }
  const manifest: TasklessInstallManifest = { targets };
  if (state.cliVersion) manifest.cliVersion = state.cliVersion;
  return manifest;
}

/**
 * Read the install state from `.taskless/taskless.json`. Returns an empty
 * state (no targets, no metadata) if the manifest or `install` field is
 * missing.
 */
export async function readInstallState(cwd: string): Promise<InstallState> {
  const { manifest } = await readManifest(join(cwd, TASKLESS_DIR));
  return toInstallState(manifest.install);
}

/**
 * Merge the provided install state into `.taskless/taskless.json`, preserving
 * every other field in the manifest (version, unknown fields, etc.).
 */
export async function writeInstallState(
  cwd: string,
  state: InstallState
): Promise<void> {
  const tasklessDirectory = join(cwd, TASKLESS_DIR);
  const { manifest, raw } = await readManifest(tasklessDirectory);
  // Shallow-merge so any sibling fields under `install` that don't round-trip
  // through `InstallState` (e.g. `onboarded`, or future opt-in flags) survive
  // re-installs. Newly-computed fields from `toInstallManifest(state)` win
  // over previous values for the same key.
  const previousInstall = manifest.install ?? {};
  manifest.install = { ...previousInstall, ...toInstallManifest(state) };
  await writeManifest(tasklessDirectory, manifest, raw);
}

function diffArrays(
  previous: string[],
  next: string[]
): { additions: string[]; removals: string[]; unchanged: string[] } {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    additions: next.filter((n) => !previousSet.has(n)),
    removals: previous.filter((p) => !nextSet.has(p)),
    unchanged: next.filter((n) => previousSet.has(n)),
  };
}

/**
 * Compute a per-target diff between two install states. The resulting entries
 * cover every target present in either state so callers can display both
 * removals-of-targets and additions-of-targets in one pass.
 */
export function computeInstallDiff(
  previous: InstallState,
  next: InstallState
): InstallDiff {
  const targets = new Set<string>([
    ...Object.keys(previous.targets),
    ...Object.keys(next.targets),
  ]);

  const entries: InstallDiffEntry[] = [];
  let hasAdditions = false;
  let hasRemovals = false;

  for (const target of [...targets].toSorted()) {
    const previous_ = previous.targets[target] ?? { skills: [], commands: [] };
    const current = next.targets[target] ?? { skills: [], commands: [] };

    const skillDiff = diffArrays(previous_.skills, current.skills);
    const commandDiff = diffArrays(previous_.commands, current.commands);

    // Prefer the next state's mode (target survives), fall back to the
    // previous state's mode (target removed), default to canonical.
    const mode: InstallMode =
      next.targets[target]?.mode ??
      previous.targets[target]?.mode ??
      "canonical";

    if (skillDiff.additions.length > 0 || commandDiff.additions.length > 0) {
      hasAdditions = true;
    }
    if (skillDiff.removals.length > 0 || commandDiff.removals.length > 0) {
      hasRemovals = true;
    }

    entries.push({
      target,
      mode,
      additions: {
        skills: skillDiff.additions,
        commands: commandDiff.additions,
      },
      removals: {
        skills: skillDiff.removals,
        commands: commandDiff.removals,
      },
      unchanged: {
        skills: skillDiff.unchanged,
        commands: commandDiff.unchanged,
      },
    });
  }

  return { entries, hasAdditions, hasRemovals };
}
