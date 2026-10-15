import { multiselect, log } from "@clack/prompts";

import {
  CANONICAL_DIR,
  DEFAULT_SHIM_DIR,
  SHIM_TARGETS,
  TOOLS,
  detectTools,
  type ToolDescriptor,
} from "../../install/install";
import { readInstallState } from "../../install/state";
import { ask } from "../ask";

/** A single entry in the tool-selection multiselect. */
export interface LocationChoice {
  value: string;
  label: string;
  hint: string;
}

/**
 * The `.agents/` row's label: the detected harnesses that read
 * `.agents/skills`, in catalog order, then "and other .agents harnesses",
 * since many more read it than Taskless detects.
 *
 * With none detected it names every harness Taskless knows reads it, so a
 * Codex or Gemini CLI user still finds their harness on a fresh machine.
 */
export function agentsRowLabel(detected: readonly ToolDescriptor[]): string {
  const detectedNames = new Set(detected.map((tool) => tool.name));
  const readers = TOOLS.filter((tool) => tool.readsAgentSkills === true);
  const named = readers.filter((tool) => detectedNames.has(tool.name));
  const names = (named.length > 0 ? named : readers).map((tool) => tool.name);
  return `${names.join(", ")}, and other .agents harnesses`;
}

/**
 * Build the tool-selection multiselect options and the pre-checked set from
 * the detected tools and the install manifest's recorded targets. Pure — no
 * prompt, no TTY, no filesystem access — so the mapping is unit-testable.
 *
 * One row per catalog directory; the canonical `.taskless/` store is never an
 * entry. The pre-checked set is the union of manifest-recorded shim
 * directories and detected tools' directories, so a location Taskless already
 * installed into shows checked and can be unchecked. `.agents/` is
 * pre-checked as the default only when nothing is recorded and nothing is
 * detected.
 *
 * Each entry's hint reflects its origin: `installed` when recorded in the
 * manifest (takes precedence), otherwise `detected` when a tool installing
 * into that directory is present, otherwise `not detected`. OpenCode is named
 * on the `.agents/` row when detected, since it reads `.agents/skills`, but it
 * does not make that row `detected` or pre-check it: it already gets
 * `.opencode/`, and both would give it the skill twice.
 *
 * @param manifestDirectories Shim directories recorded in the install
 *   manifest; the canonical `.taskless/` directory is ignored if present.
 */
export function locationChoices(
  detected: ToolDescriptor[],
  manifestDirectories: readonly string[] = []
): {
  options: LocationChoice[];
  initialValues: string[];
} {
  const detectedDirectories = new Set(detected.map((t) => t.installDir));
  const installedDirectories = new Set(
    manifestDirectories.filter((d) => d !== CANONICAL_DIR)
  );

  const preChecked = SHIM_TARGETS.map((shim) => shim.dir).filter(
    (directory) =>
      installedDirectories.has(directory) || detectedDirectories.has(directory)
  );
  const initialValues = preChecked.length > 0 ? preChecked : [DEFAULT_SHIM_DIR];

  const options = SHIM_TARGETS.map((shim) => ({
    value: shim.dir,
    label: `${shim.generic === true ? agentsRowLabel(detected) : shim.label} (${shim.dir}/)`,
    hint: installedDirectories.has(shim.dir)
      ? "installed"
      : detectedDirectories.has(shim.dir)
        ? "detected"
        : "not detected",
  }));

  return { options, initialValues };
}

/**
 * Ask which tools to enable Taskless for. The canonical `.taskless/` store is
 * always written and is not offered here — these choices only control which
 * tool directories receive a reference stub.
 */
export async function promptLocations(cwd: string): Promise<string[]> {
  const detected = await detectTools(cwd);
  const installState = await readInstallState(cwd);
  const manifestDirectories = Object.keys(installState.targets);
  const { options, initialValues } = locationChoices(
    detected,
    manifestDirectories
  );

  while (true) {
    const selected = await ask("locations", () =>
      multiselect<string>({
        message: "Which tools do you want to enable Taskless for?",
        options,
        initialValues,
        required: false,
      })
    );

    if (selected.length === 0) {
      log.error("Select at least one tool.");
      continue;
    }

    return selected;
  }
}
