import { groupMultiselect, log } from "@clack/prompts";

import {
  CANONICAL_DIR,
  DEFAULT_SHIM_DIR,
  SHIM_TARGETS,
  TOOLS,
  detectMachineTools,
  detectTools,
  installDirectoryFor,
  type ToolDescriptor,
} from "../../install/install";
import type { GlobalTrustEnvironment } from "../../install/global-trust";
import { readInstallState } from "../../install/state";
import { ask } from "../ask";

/** A single row in the tool-selection step. */
export interface LocationChoice {
  value: string;
  label: string;
  hint?: string;
}

/** The value of the row for every `.agents/` harness without its own row. */
export const GENERIC_ROW = "agents";

export const PROJECT_SECTION = "Detected in this project";
export const MACHINE_SECTION = "Detected on this machine";
export const OTHER_SECTION = "Other harnesses";

interface Row {
  value: string;
  label: string;
  dir: string;
}

/** Every row, in catalog order, the generic row last. */
function rows(projectDetected: ReadonlySet<string>): Row[] {
  const harnessRows = TOOLS.map((tool) => {
    const directory = installDirectoryFor(tool, projectDetected.has(tool.name));
    return {
      value: tool.name,
      label: `${tool.name} (${directory}/)`,
      dir: directory,
    };
  });
  return [
    ...harnessRows,
    {
      value: GENERIC_ROW,
      label: `Other Agent Skills harnesses (${DEFAULT_SHIM_DIR}/)`,
      dir: DEFAULT_SHIM_DIR,
    },
  ];
}

/**
 * Build the tool-selection rows and the pre-checked set. Pure — no prompt,
 * no TTY, no filesystem access — so the mapping is unit-testable.
 *
 * One row per harness, so a user finds the harness they run without knowing
 * which skill directory it reads; several rows may install into one
 * directory. Rows are grouped by where the harness was detected: in the
 * project, on this machine only, or not at all. The generic `.agents/` row is
 * always in the last group.
 *
 * Pre-checked: every project-detected row, then for each manifest-recorded
 * directory none of those covers, the row installing into it (the generic row
 * for `.agents/`). With nothing either way, the generic row. Machine-detected
 * rows are never pre-checked: they only move up the list. The section says
 * where a harness was found, so the one hint is `installed`.
 *
 * @param manifestDirectories Shim directories recorded in the install
 *   manifest; the canonical `.taskless/` directory is ignored if present.
 */
export function locationChoices(
  detected: readonly ToolDescriptor[],
  machineDetected: readonly ToolDescriptor[] = [],
  manifestDirectories: readonly string[] = []
): {
  groups: Record<string, LocationChoice[]>;
  initialValues: string[];
} {
  const projectNames = new Set(detected.map((tool) => tool.name));
  const machineNames = new Set(machineDetected.map((tool) => tool.name));
  const installed = new Set(
    manifestDirectories.filter((d) => d !== CANONICAL_DIR)
  );
  const all = rows(projectNames);

  const checked = new Set(
    all.filter((row) => projectNames.has(row.value)).map((row) => row.value)
  );
  const covered = new Set(
    all.filter((row) => checked.has(row.value)).map((row) => row.dir)
  );
  for (const shim of SHIM_TARGETS) {
    if (!installed.has(shim.dir) || covered.has(shim.dir)) continue;
    const row =
      shim.dir === DEFAULT_SHIM_DIR
        ? all.find((r) => r.value === GENERIC_ROW)
        : all.find((r) => r.dir === shim.dir);
    if (row !== undefined) checked.add(row.value);
  }
  if (checked.size === 0) checked.add(GENERIC_ROW);

  const groups: Record<string, LocationChoice[]> = {};
  for (const row of all) {
    const section = projectNames.has(row.value)
      ? PROJECT_SECTION
      : machineNames.has(row.value)
        ? MACHINE_SECTION
        : OTHER_SECTION;
    const choice: LocationChoice = { value: row.value, label: row.label };
    if (checked.has(row.value) && installed.has(row.dir)) {
      choice.hint = "installed";
    }
    (groups[section] ??= []).push(choice);
  }

  // Sections in a fixed order, whatever order the rows filled them in.
  const ordered: Record<string, LocationChoice[]> = {};
  for (const section of [PROJECT_SECTION, MACHINE_SECTION, OTHER_SECTION]) {
    if (groups[section] !== undefined) ordered[section] = groups[section];
  }

  return {
    groups: ordered,
    initialValues: all
      .filter((row) => checked.has(row.value))
      .map((row) => row.value),
  };
}

/** What the checked rows install. */
export interface LocationSelection {
  /** Directories to install into, each once, in plan order. */
  directories: string[];
  /** The checked harness rows, by name; the generic row is not a harness. */
  harnesses: string[];
}

/**
 * Resolve checked row values to directories and harnesses. Pure, and given
 * the project-detected harnesses since those decide where Devin installs.
 */
export function resolveSelection(
  values: readonly string[],
  detected: readonly ToolDescriptor[]
): LocationSelection {
  const all = rows(new Set(detected.map((tool) => tool.name)));
  const picked = all.filter((row) => values.includes(row.value));
  const directories = new Set(picked.map((row) => row.dir));
  return {
    directories: SHIM_TARGETS.map((shim) => shim.dir).filter((d) =>
      directories.has(d)
    ),
    harnesses: picked
      .map((row) => row.value)
      .filter((value) => value !== GENERIC_ROW),
  };
}

/**
 * Ask which tools to enable Taskless for. The canonical `.taskless/` store is
 * always written and is not offered here — these choices only control which
 * tool directories receive a reference stub.
 */
export async function promptLocations(
  cwd: string,
  environment: GlobalTrustEnvironment
): Promise<LocationSelection> {
  const detected = await detectTools(cwd);
  const machineDetected = await detectMachineTools(environment);
  const installState = await readInstallState(cwd);
  const manifestDirectories = Object.keys(installState.targets);
  const { groups, initialValues } = locationChoices(
    detected,
    machineDetected,
    manifestDirectories
  );

  while (true) {
    const selected = await ask("locations", () =>
      groupMultiselect<string>({
        message: "Which tools do you want to enable Taskless for?",
        options: groups,
        initialValues,
        required: false,
        selectableGroups: false,
      })
    );

    if (selected.length === 0) {
      log.error("Select at least one tool.");
      continue;
    }

    return resolveSelection(selected, detected);
  }
}
