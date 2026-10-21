import { homedir } from "node:os";
import process from "node:process";

import { intro, outro, cancel, log } from "@clack/prompts";

import { getOnboardTrailer } from "../commands/onboard";
import { ensureTasklessDirectory } from "../filesystem/directory";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedSkills,
  planToStateTargets,
} from "../install/install";
import {
  buildLauncherInvocation,
  describeLauncherWrite,
} from "../install/launcher";
import {
  globalTrustWarnings,
  needsWrite,
  syncGlobalTrust,
  type GlobalTrustEnvironment,
} from "../install/global-trust";
import { syncPermissions } from "../install/permissions";
import { findStalePins, getPinnedCliNotice } from "../install/pinned-cli";
import { getReloadNotice } from "../install/reload-notice";
import { computeInstallDiff, readInstallState } from "../install/state";
import { findUncommitted, installedPaths } from "../install/uncommitted";
import {
  getTelemetry,
  isTelemetryEnabled,
  TELEMETRY_NOTICE,
  TELEMETRY_NOTICE_TITLE,
} from "../telemetry";
import { CLIError } from "../util/cli-error";
import { buildInvocation } from "../util/invocation";
import { getCliPrefix } from "../util/package-manager";

import { WizardCancelled } from "./ask";
import { getCliVersion, renderIntro } from "./intro";
import { promptCommit } from "./steps/commit";
import { promptLocations } from "./steps/locations";
import { renderSummaryAndConfirm } from "./steps/summary";

export interface RunWizardOptions {
  cwd: string;
  /** Where user-level settings live. Defaults to the real home directory. */
  globalTrustEnvironment?: GlobalTrustEnvironment;
}

export interface WizardResult {
  status: "completed" | "cancelled";
  locations: string[];
  optionalSkills: string[];
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

  console.error(renderIntro());
  intro(" Taskless setup ");

  const globalTrustEnvironment = options.globalTrustEnvironment ?? {
    home: homedir(),
    env: process.env,
  };

  try {
    const selection = await promptLocations(
      options.cwd,
      globalTrustEnvironment
    );
    locations = selection.directories;

    // Catalog has one entry now (`taskless`); install all embedded skills.
    const plan = buildInstallPlan(locations, getEmbeddedSkills());

    const previousState = await readInstallState(options.cwd);
    const diff = computeInstallDiff(previousState, {
      cliVersion: previousState.cliVersion,
      targets: planToStateTargets(plan),
    });

    // Previewed before anything is written, so every settings file the
    // install will touch is on screen before the user confirms.
    const permissionOptions = {
      selected: plan.targets
        .filter((target) => target.mode === "reference")
        .map((target) => target.dir),
      codex: selection.harnesses.includes("Codex"),
      invocation: buildInvocation(),
      launcher: buildLauncherInvocation(),
    };
    const permissionPreview = await syncPermissions(options.cwd, {
      ...permissionOptions,
      write: false,
    });

    const globalTrustOptions = {
      selected: permissionOptions.selected,
      environment: globalTrustEnvironment,
    };
    const globalTrustPreview = await syncGlobalTrust({
      ...globalTrustOptions,
      write: false,
    });

    const proceed = await renderSummaryAndConfirm(diff, permissionPreview, {
      outcomes: globalTrustPreview,
      home: globalTrustEnvironment.home,
    });
    if (!proceed) {
      cancel(`Install cancelled. Run \`${getCliPrefix()} init\` to try again.`);
      cancelledStep = "summary";
      return finish({ status: "cancelled" });
    }

    // The migration's start opens a step; its summary, and the launcher
    // lines below, continue under it rather than each opening one of their
    // own, so one install reads as one block.
    let migrationStarted = false;
    const migrated = await ensureTasklessDirectory(options.cwd, {
      onNotice: (message) => {
        if (migrationStarted) {
          log.message(message, { spacing: 0 });
        } else {
          log.info(message);
          migrationStarted = true;
        }
      },
    });
    const cliVersion = getCliVersion();
    const { launcher, lockfile } = await applyInstallPlan(options.cwd, plan, {
      cliVersion,
    });
    const created: string[] = [];
    for (const write of [launcher, lockfile]) {
      if (write === null || write.state === "unchanged") continue;
      if (write.state === "restored") {
        log.warn(describeLauncherWrite(write));
      } else {
        created.push(describeLauncherWrite(write));
      }
    }
    if (created.length > 0) log.message(created.join("\n"));
    await syncPermissions(options.cwd, { ...permissionOptions, write: true });
    // Confirmed with the project edits, in the summary's one question.
    if (globalTrustPreview.some((outcome) => needsWrite(outcome))) {
      await syncGlobalTrust({ ...globalTrustOptions, write: true });
    }
    // Read again rather than assumed, so a skipped file, and a write that did
    // not land, still warn.
    const globalTrust = await syncGlobalTrust({
      ...globalTrustOptions,
      write: false,
    });
    for (const warning of globalTrustWarnings(
      globalTrust,
      getCliPrefix(),
      globalTrustEnvironment.home
    )) {
      log.warn(warning);
    }

    if (await isTelemetryEnabled(options.cwd)) {
      log.info(`${TELEMETRY_NOTICE_TITLE}\n${TELEMETRY_NOTICE}`);
    }

    // Inside the frame, after every write: the commit has to carry the
    // settings edits above as well as the skills. Before the outro, because
    // the onboarding line that follows sends the person to their agent.
    const owned = await installedPaths(options.cwd, plan);
    const uncommitted = await findUncommitted(options.cwd, owned);
    // Asked again after the prompt rather than inferred from its answer: a
    // cancel, a skip, and a commit git refused all leave the files on disk and
    // out of history, and the outro is the one line that has to say so. A
    // cancel here used to close on "ready to go", which read as though the
    // commit had happened.
    let leftUncommitted = false;
    if (uncommitted.length > 0) {
      await promptCommit(options.cwd, uncommitted);
      const remaining = await findUncommitted(options.cwd, owned);
      leftUncommitted = remaining.length > 0;
    }

    outro(
      leftUncommitted
        ? "Taskless is installed, but its files are not committed yet."
        : "Taskless is ready to go."
    );
    const pinnedNotice = getPinnedCliNotice(
      await findStalePins(options.cwd, cliVersion),
      cliVersion,
      { migrated }
    );
    if (pinnedNotice !== undefined) console.log(pinnedNotice);
    // `previousState` was read before the plan was applied, so it still holds
    // the version this project was on when the session that is watching this
    // install started.
    const reloadNotice = getReloadNotice({
      previousCliVersion: previousState.cliVersion,
      cliVersion,
    });
    if (reloadNotice !== undefined) console.log(reloadNotice);
    console.log(getOnboardTrailer());
    return finish({ status: "completed" });
  } catch (error) {
    if (error instanceof WizardCancelled) {
      cancel(
        `Wizard cancelled at step "${error.step}". Run \`${getCliPrefix()} init\` to try again.`
      );
      cancelledStep = error.step;
      return finish({ status: "cancelled" });
    }
    // Any other expected failure aborts between `intro()` and `outro()`, so
    // the frame clack already opened is still on screen. Close it with the
    // message rather than letting the top-level handler print outside it: the
    // first thing the wizard does is read the manifest (`promptLocations` ->
    // `readInstallState`), which is exactly where an unreadable manifest
    // throws, and the repair-or-delete refusal is worth showing in full.
    // Rethrown as `reported` so index.ts sets the exit code without printing
    // the same text a second time.
    if (error instanceof CLIError) {
      cancel(error.message);
      throw new CLIError(error.message, error.code, { reported: true });
    }
    throw error;
  }

  function finish(args: { status: "completed" | "cancelled" }): WizardResult {
    const durationMs = Date.now() - start;
    if (args.status === "completed") {
      // Concrete state event: skills were installed (interactive).
      telemetry.capture("cli_installed");
    }
    return {
      status: args.status,
      locations,
      optionalSkills,
      durationMs,
      cancelledStep,
    };
  }
}

/** Re-export so callers can detect wizard cancellation by class. */
export { WizardCancelled } from "./ask";
