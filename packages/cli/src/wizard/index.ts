import { intro, outro, cancel, log } from "@clack/prompts";

import { getOnboardTrailer } from "../commands/onboard";
import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedCommands,
  getEmbeddedSkills,
  planToStateTargets,
} from "../install/install";
import { getReloadNotice } from "../install/reload-notice";
import { computeInstallDiff, readInstallState } from "../install/state";
import { getTelemetry } from "../telemetry";

import { WizardCancelled } from "./ask";
import { getCliVersion, renderIntro } from "./intro";
import { promptLocations } from "./steps/locations";
import { promptAuth } from "./steps/auth";
import { renderSummaryAndConfirm } from "./steps/summary";

export interface RunWizardOptions {
  cwd: string;
}

export interface WizardResult {
  status: "completed" | "cancelled";
  locations: string[];
  optionalSkills: string[];
  authPromptShown: boolean;
  authCompleted: boolean;
  durationMs: number;
  cancelledStep?: string;
}

export async function runWizard(
  options: RunWizardOptions
): Promise<WizardResult> {
  const start = Date.now();
  const telemetry = await getTelemetry(options.cwd);

  let cancelledStep: string | undefined;
  let locations: string[] = [];
  // Optional skills no longer exist post-consolidation — always empty.
  const optionalSkills: string[] = [];
  let authPromptShown = false;
  let authCompleted = false;

  console.error(renderIntro());
  intro(" Taskless setup ");

  try {
    locations = await promptLocations(options.cwd);
    const authResult = await promptAuth(options.cwd);
    authPromptShown = authResult.prompted;
    authCompleted = authResult.loggedIn;

    // Catalog has one entry now (`taskless`); install all embedded skills.
    const plan = buildInstallPlan(
      locations,
      getEmbeddedSkills(),
      getEmbeddedCommands()
    );

    const previousState = await readInstallState(options.cwd);
    const diff = computeInstallDiff(previousState, {
      cliVersion: previousState.cliVersion,
      targets: planToStateTargets(plan),
    });

    const proceed = await renderSummaryAndConfirm(diff);
    if (!proceed) {
      cancel("Install cancelled. Run `taskless init` to try again.");
      cancelledStep = "summary";
      return finish({ status: "cancelled" });
    }

    await ensureTasklessDirectory(options.cwd, {
      onNotice: (message) => log.info(message),
    });
    const cliVersion = getCliVersion();
    await applyInstallPlan(options.cwd, plan, { cliVersion });

    outro("Taskless is ready to go.");
    const commandsInstalled = plan.targets.some(
      (t) => t.mode === "reference" && t.commands.length > 0
    );
    // `previousState` was read before the plan was applied, so it still holds
    // the version this project was on when the session that is watching this
    // install started.
    const reloadNotice = getReloadNotice({
      previousCliVersion: previousState.cliVersion,
      cliVersion,
    });
    if (reloadNotice !== undefined) console.log(reloadNotice);
    console.log(getOnboardTrailer({ commandsInstalled }));
    return finish({ status: "completed" });
  } catch (error) {
    if (error instanceof WizardCancelled) {
      cancel(
        `Wizard cancelled at step "${error.step}". Run \`taskless init\` to try again.`
      );
      cancelledStep = error.step;
      return finish({ status: "cancelled" });
    }
    throw error;
  }

  function finish(args: { status: "completed" | "cancelled" }): WizardResult {
    const durationMs = Date.now() - start;
    if (args.status === "completed") {
      // Concrete state event: skills/commands were installed (interactive).
      telemetry.capture("cli_installed");
    }
    return {
      status: args.status,
      locations,
      optionalSkills,
      authPromptShown,
      authCompleted,
      durationMs,
      cancelledStep,
    };
  }
}

/** Re-export so callers can detect wizard cancellation by class. */
export { WizardCancelled } from "./ask";
