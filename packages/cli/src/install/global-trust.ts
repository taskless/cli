import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself.
import "../util/color";

import { isRecord } from "../util/is-record";
import { parseJson, set, valueAt } from "./permissions";

/**
 * User-level trust for harnesses whose safety classifier overrules a project
 * allow rule.
 *
 * Claude Code's auto mode does not trust a project allow rule that runs
 * downloaded code, and does not read its exceptions from a checked-in project
 * file at all, since a cloned repo could then whitelist itself. The user
 * already made that trust decision when they installed Taskless; the only
 * place it can be carried into a session is the user's own settings, and the
 * only moment a human is there to make it is the interactive install.
 *
 * Unlike a project rule, the entry is personal state: it is never recorded in
 * the project manifest, never names a version, is written at most once, and
 * is never removed. A present entry is found by its label, so rewording the
 * text later never touches an entry a user already has.
 *
 * The list is closed. A harness joins once it is verified that its classifier
 * can refuse what its project file allows, and that its user settings accept
 * a written exception.
 */

/** The label every entry begins with, and how a present one is found. */
const LABEL = "Taskless CLI:";

/**
 * The entry itself, identical in every version. The example version is fake on
 * purpose, so the text never ages.
 */
export const GLOBAL_TRUST_ENTRY =
  `${LABEL} The npm packages @taskless/cli and @taskless/cli-nightly are ` +
  "tooling published by Taskless via npm trusted publishing (OIDC), installed " +
  "by the user through the Taskless installer. Running either via npx or pnpm " +
  "dlx is allowed only when the call names an exact version (e.g. " +
  "@taskless/cli@1.2.3). Dist-tags such as @latest or @nightly, version " +
  "ranges, and unversioned calls are not covered.";

/** Where a harness's user settings live, from the environment. */
export interface GlobalTrustEnvironment {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

interface GlobalTrust {
  harness: string;
  /** The install target that brings this harness in. */
  selectedBy: string;
  /** The settings file, absolute. */
  path(environment: GlobalTrustEnvironment): string;
  /** The list the entry goes in. */
  key: readonly string[];
  /** The list to write when there is none, holding the entry. */
  seed: readonly string[];
}

const claudeCode: GlobalTrust = {
  harness: "Claude Code",
  selectedBy: ".claude",
  // Claude Code moves its whole configuration directory with this variable.
  path: ({ home, env }) =>
    join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json"),
  key: ["autoMode", "allow"],
  // `$defaults` splices in the shipped exceptions. A new list without it
  // would replace them, and the user would lose every one.
  seed: ["$defaults", GLOBAL_TRUST_ENTRY],
};

const GLOBAL_TRUST: readonly GlobalTrust[] = [claudeCode];

/** One harness's entry, in the shape `init --json` carries. */
export interface GlobalTrustOutcome {
  harness: string;
  /** Absolute path of the settings file. */
  file: string;
  /** The list the entry belongs in, dotted: `autoMode.allow`. */
  key: string;
  /**
   * `present`: already there, untouched. `absent`: missing, nothing written.
   * `written`: added by this run. `skipped`: left alone, see `skipped`.
   */
  state: "present" | "absent" | "written" | "skipped";
  /** Why the file was left alone, or `null` when it was not. */
  skipped: string | null;
}

export interface SyncGlobalTrustOptions {
  /** Tool directories the skill is installed into. */
  selected: readonly string[];
  /** `true` adds a missing entry; `false` only reports. */
  write: boolean;
  /** Defaults to the real home directory and environment. */
  environment?: GlobalTrustEnvironment;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

type Inspection =
  | { kind: "present" }
  | { kind: "absent"; text: string }
  | { kind: "skip"; reason: string };

/** Whether the file holds the entry, and the edited text when it does not. */
function inspect(trust: GlobalTrust, current = "{}\n"): Inspection {
  const root = parseJson(current);
  if (!isRecord(root)) {
    return { kind: "skip", reason: "does not parse, so it was left as it is" };
  }
  for (let depth = 1; depth < trust.key.length; depth++) {
    const parent = valueAt(root, trust.key.slice(0, depth));
    if (parent !== undefined && !isRecord(parent)) {
      return {
        kind: "skip",
        reason: `${trust.key.slice(0, depth).join(".")} is not an object`,
      };
    }
  }
  const list = valueAt(root, trust.key);
  if (list === undefined) {
    return {
      kind: "absent",
      text: set(current, [...trust.key], [...trust.seed]),
    };
  }
  if (!Array.isArray(list)) {
    return { kind: "skip", reason: `${trust.key.join(".")} is not a list` };
  }
  if (list.some((item) => typeof item === "string" && item.startsWith(LABEL))) {
    return { kind: "present" };
  }
  // An existing list without `$defaults` is the user replacing the defaults on
  // purpose, so it is appended to as it stands.
  return {
    kind: "absent",
    text: set(current, [...trust.key, list.length], GLOBAL_TRUST_ENTRY, {
      isArrayInsertion: true,
    }),
  };
}

/**
 * Report, and with `write` add, the global trust entry for each selected
 * harness that has one. A present entry is never rewritten.
 */
export async function syncGlobalTrust(
  options: SyncGlobalTrustOptions
): Promise<GlobalTrustOutcome[]> {
  const environment = options.environment ?? {
    home: homedir(),
    env: process.env,
  };
  const outcomes: GlobalTrustOutcome[] = [];
  for (const trust of GLOBAL_TRUST) {
    if (!options.selected.includes(trust.selectedBy)) continue;
    const file = trust.path(environment);
    const base = { harness: trust.harness, file, key: trust.key.join(".") };
    const result = inspect(trust, await readText(file));
    if (result.kind === "skip") {
      outcomes.push({ ...base, state: "skipped", skipped: result.reason });
      continue;
    }
    if (result.kind === "present" || !options.write) {
      outcomes.push({ ...base, state: result.kind, skipped: null });
      continue;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, result.text, "utf8");
    outcomes.push({ ...base, state: "written", skipped: null });
  }
  return outcomes;
}

/** `~/…` for a path under the home directory, so the summary reads short. */
function display(file: string, home: string): string {
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/**
 * The proposed edit for each missing entry, for the wizard's summary. The
 * heading says the file is outside the project, since nothing else the
 * install touches is.
 */
export function describeGlobalTrust(
  outcomes: readonly GlobalTrustOutcome[],
  home: string = homedir()
): string[] {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.state !== "absent") continue;
    lines.push(
      `Edit ${display(outcome.file, home)} (your ${outcome.harness} settings, outside this project)`,
      `  ${chalk.green(`ALLOW: ${outcome.key} += ${GLOBAL_TRUST_ENTRY}`)}`
    );
  }
  return lines;
}

/** A warning for each harness still missing its entry. */
export function globalTrustWarnings(
  outcomes: readonly GlobalTrustOutcome[],
  home: string = homedir()
): string[] {
  return outcomes
    .filter(
      (outcome) => outcome.state === "absent" || outcome.state === "skipped"
    )
    .map(
      (outcome) =>
        `${outcome.harness} may refuse Taskless commands that the project rule allows: its safety classifier overrules project allow rules. ` +
        `To trust Taskless, add this entry to the top-level \`${outcome.key}\` list in ${display(outcome.file, home)}` +
        (outcome.state === "skipped"
          ? ` (left alone: ${outcome.skipped})`
          : "") +
        `, after "$defaults":\n  ${GLOBAL_TRUST_ENTRY}`
    );
}
