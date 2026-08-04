import { resolve } from "node:path";

import { defineCommand } from "citty";

import { ensureTasklessDirectory } from "../filesystem/directory";
import { readManifest, writeManifest } from "../filesystem/migrate";
import { getTelemetry } from "../telemetry";
import { CLIError } from "../util/cli-error";

import { getRecipe } from "./help";

/**
 * One-line trailer printed by `taskless init` (and the wizard) after a
 * successful install. Lives here so the install paths share the same
 * wording with the onboard subcommand they point at.
 *
 * Branches on whether any installed target received the `tskl` slash
 * command. Tools that get commands (Claude Code, Cursor) also get the
 * Taskless skill, so the with-commands trailer mentions both AI-tool
 * paths; tools without commands (OpenCode, Codex, `.agents` fallback)
 * still get the skill, so the no-commands trailer points at the skill.
 * Both trailers also mention `taskless onboard` as the bare CLI fallback.
 */
export function getOnboardTrailer(args: {
  commandsInstalled: boolean;
}): string {
  if (args.commandsInstalled) {
    return "Next: in your AI tool, run /tskl onboard or ask it to use the Taskless skill (or run `taskless onboard` from your terminal) to discover rule candidates from your codebase.";
  }
  return "Next: in your AI tool, ask it to use the Taskless skill (or run `taskless onboard` from your terminal) to discover rule candidates from your codebase.";
}

export const onboardCommand = defineCommand({
  meta: {
    name: "onboard",
    description:
      "Discover rule candidates from your codebase and history (post-install flow)",
  },
  args: {
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    force: {
      type: "boolean",
      description:
        "Re-run the recipe even when onboarding is already marked complete",
      default: false,
    },
    "mark-complete": {
      type: "boolean",
      description:
        "Record onboarding as complete in .taskless/taskless.json (invoked by the agent after explicit user confirmation)",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    const telemetry = await getTelemetry(cwd);

    if (args.force && args["mark-complete"]) {
      console.error(
        "Error: --force and --mark-complete cannot be used together."
      );
      console.error(
        "  --force re-runs the discovery recipe; --mark-complete records completion."
      );
      process.exitCode = 1;
      throw new CLIError("conflicting flags", undefined, { reported: true });
    }

    await ensureTasklessDirectory(cwd);
    const tasklessDirectory = resolve(cwd, ".taskless");

    if (args["mark-complete"]) {
      const { manifest, raw } = await readManifest(tasklessDirectory);
      const install = manifest.install ?? {};
      install.onboarded = true;
      manifest.install = install;
      await writeManifest(tasklessDirectory, manifest, raw);
      console.log("Marked Taskless onboarding as complete.");
      // Concrete state event: onboarding reached completion.
      telemetry.capture("cli_onboarded");
      return;
    }

    const { manifest } = await readManifest(tasklessDirectory);
    const alreadyOnboarded = manifest.install?.onboarded === true;

    if (alreadyOnboarded && !args.force) {
      console.log("Taskless onboarding is already marked complete.");
      console.log(
        "Run `taskless onboard --force` to re-run the discovery recipe."
      );
      return;
    }

    const recipe = getRecipe("onboard");
    if (recipe === undefined) {
      // Should not happen — onboard.txt is embedded at build time.
      console.error("Internal error: onboard recipe is not available.");
      process.exitCode = 1;
      throw new CLIError("recipe missing", undefined, { reported: true });
    }
    console.log(recipe.trimEnd());
  },
});
