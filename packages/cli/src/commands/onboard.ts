import { resolve } from "node:path";
import process from "node:process";

import chalk from "chalk";
import { defineCommand } from "citty";

import { detectHostTools } from "../detect/host-tools";
import { ensureTasklessDirectory } from "../filesystem/directory";
import { readManifest, writeManifest } from "../filesystem/manifest";
import { getRecipe } from "../prompts/recipes";
import { withSurveyInvite } from "../survey/invite";
import { getTelemetry } from "../telemetry";
import { CLIError } from "../util/cli-error";
// Sets `chalk.level` from the real terminal on import. The trailer colours its
// prompt line, so it establishes that itself.
import "../util/color";
import {
  detectCliInvocation,
  getCliPrefix,
  processLauncherContext,
} from "../util/package-manager";

/**
 * The prompt the trailer hands the user, exactly as they should paste it.
 */
export const ONBOARD_PROMPT = "Onboard this project with Taskless";

/**
 * Trailer printed by `taskless init` (and the wizard) after a successful
 * install. Lives here so the install paths share the same wording with the
 * onboard subcommand they point at.
 *
 * Every install target receives the Taskless skill, so the trailer points
 * at the skill in plain language and nothing else: no slash command, no
 * terminal fallback.
 *
 * One line of explanation, then the prompt alone on the final line. The
 * prompt line carries no quotes, bullet, or prefix, so a triple-click copies
 * exactly the prompt. Colour only marks it as the thing to copy: cyan, in the
 * family of the logo's teal but brighter, since the prompt has to stand out
 * and the logo's `#2B7384` is muted. With colour off, which
 * `util/color` decides (`NO_COLOR`, or stdout not a terminal), chalk prints
 * it plain and the layout alone keeps it copyable.
 */
export function getOnboardTrailer(): string {
  return [
    "Your AI tool has the Taskless skill now. Paste this to set up your first rules for your Agents to follow:",
    chalk.cyan(ONBOARD_PROMPT),
  ].join("\n");
}

export const onboardCommand = defineCommand({
  meta: {
    name: "onboard",
    description:
      "Set up Taskless: discover and write starter rules from your codebase and history, then publish a report (post-install discovery flow)",
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
        `Run \`${getCliPrefix()} onboard --force\` to re-run the discovery recipe.`
      );
      return;
    }

    // Detected here rather than inside the prompts module, which Workers
    // import without `nodejs_compat`. This command serves the recipe on its
    // own, without going through `agent`, so omitting this renders every
    // invocation in it as the agent-fill marker for anyone running a
    // published build.
    const invocation = detectCliInvocation(processLauncherContext());
    // Detected here for the same reason `invocation` is: the render path is
    // imported by Workers without `nodejs_compat` and may not read `PATH`.
    // `agent onboard` computes the same state from the same `cwd`; the two
    // must agree, and `onboard.test.ts` asserts they do byte for byte.
    const hostTools = await detectHostTools(cwd);
    const recipe = getRecipe("onboard", {
      invocation,
      hostTools,
      // Served text is a fetch, the same as `agent onboard`, which this must
      // match byte for byte.
      directive: true,
    });
    if (recipe === undefined) {
      // Should not happen — onboard.md is embedded at build time.
      console.error("Internal error: onboard recipe is not available.");
      process.exitCode = 1;
      throw new CLIError("recipe missing", undefined, { reported: true });
    }
    // Same gate as `agent onboard`: this is the other serving path for the
    // same recipe, and the invite has to reach both or the cadence lies.
    console.log(
      await withSurveyInvite({
        recipe,
        topic: "onboard",
        invocation,
        cwd,
        ci: process.env.CI,
      })
    );
  },
});
