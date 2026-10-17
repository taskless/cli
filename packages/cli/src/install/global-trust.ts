import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { isProductionInvocation } from "../util/invocation";
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
 * the project manifest, never names a version, and is never removed. It is
 * found by its label, and the label is ours: an entry under it whose text is
 * not the current one is stale, and the wizard replaces it, since we know
 * which text works and a hand-copied or older one may not.
 *
 * Each package has its own entry and label, so the release and a nightly
 * installed on the same machine never read each other's entry as stale. With
 * one shared label, whichever build was reworded last would offer to replace
 * the other's text on every run, and the other would offer to put it back.
 *
 * The list is closed. A harness joins once it is verified that its classifier
 * can refuse what its project file allows, and that its user settings accept
 * a written exception.
 */

/** One package's entry, and the label it begins with and is found by. */
export interface GlobalTrustText {
  /** The package the entry covers. */
  packageName: string;
  label: string;
  entry: string;
}

/**
 * The entry for one package. The example version is fake on purpose, so the
 * text never ages.
 *
 * The package names are written here, not routed through
 * `applyCliInvocation()`: each entry names its own package in every build,
 * which is what lets a release and a nightly each recognise their own.
 */
function trustText(
  packageName: string,
  label: string,
  exampleVersion: string
): GlobalTrustText {
  return {
    packageName,
    label,
    entry:
      `${label} The npm package ${packageName} is tooling published by ` +
      "Taskless via npm trusted publishing (OIDC), installed by the user " +
      "through the Taskless installer. Running it via npx or pnpm dlx is " +
      "allowed only when the call names an exact version (e.g. " +
      `${packageName}@${exampleVersion}). The call stays covered when the ` +
      "same command line also sets a variable, changes or creates a " +
      "directory, or redirects the call's output to a file; every other " +
      "command on the line is judged on its own. Dist-tags such as @latest " +
      "or @nightly, version ranges, and unversioned calls are not covered.",
  };
}

export const RELEASE_TRUST = trustText(
  // ast-grep-ignore: no-unrouted-cli-invocation
  "@taskless/cli",
  "Taskless CLI:",
  "1.2.3"
);

export const NIGHTLY_TRUST = trustText(
  // ast-grep-ignore: no-unrouted-cli-invocation
  "@taskless/cli-nightly",
  "Taskless CLI nightly:",
  "1.2.3-20260101000000xabcdef0"
);

/**
 * This build's entry: the release's for the released package, the nightly's
 * otherwise. A `self` build runs from a path and needs no entry of its own,
 * and is a step toward a nightly, so it offers that one.
 */
export const BUILD_TRUST: GlobalTrustText = isProductionInvocation()
  ? RELEASE_TRUST
  : NIGHTLY_TRUST;

/** This build's entry text. */
export const GLOBAL_TRUST_ENTRY = BUILD_TRUST.entry;

/** The skill source's spelling of this build's label and entry. */
const LABEL_PLACEHOLDER = "%(TASKLESS_TRUST_LABEL)s";
const ENTRY_PLACEHOLDER = "%(TASKLESS_TRUST_ENTRY)s";

/**
 * Render this build's label and entry into an installed skill body, so the
 * fallback an agent reads names the entry this build's wizard writes.
 * Substituted as exact tokens, as the invocation placeholder is.
 */
export function renderTrustPlaceholders(content: string): string {
  return content
    .replaceAll(ENTRY_PLACEHOLDER, BUILD_TRUST.entry)
    .replaceAll(LABEL_PLACEHOLDER, BUILD_TRUST.label);
}

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
  // Set but empty is unset, or the path would resolve against the cwd.
  path: ({ home, env }) => {
    const directory = env.CLAUDE_CONFIG_DIR;
    return join(
      directory === undefined || directory === ""
        ? join(home, ".claude")
        : directory,
      "settings.json"
    );
  },
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
   * `present`: the current text, untouched. `absent`: missing, nothing
   * written. `stale`: labelled with other text, nothing written. `written`:
   * added or replaced by this run. `skipped`: left alone, see `skipped`.
   */
  state: "present" | "absent" | "stale" | "written" | "skipped";
  /** Why the file was left alone, or `null` when it was not. */
  skipped: string | null;
}

export interface SyncGlobalTrustOptions {
  /** Tool directories the skill is installed into. */
  selected: readonly string[];
  /** `true` adds a missing entry or replaces a stale one; `false` only reports. */
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
  | { kind: "absent" | "stale"; text: string }
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
  const index = list.findIndex(
    (item) => typeof item === "string" && item.startsWith(BUILD_TRUST.label)
  );
  if (index !== -1) {
    if (list[index] === GLOBAL_TRUST_ENTRY) return { kind: "present" };
    // Replaced where it sits, so the user's ordering survives. A second
    // labelled string is left alone: deleting from a user's list is more
    // than the one line the summary shows.
    return {
      kind: "stale",
      text: set(current, [...trust.key, index], GLOBAL_TRUST_ENTRY),
    };
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
 * Report, and with `write` add or refresh, the global trust entry for each
 * selected harness that has one. A present entry is never rewritten.
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

/** Whether the wizard has an edit to offer for this outcome. */
export function needsWrite(outcome: GlobalTrustOutcome): boolean {
  return outcome.state === "absent" || outcome.state === "stale";
}

/** `~/…` for a path under the home directory, so the summary reads short. */
function display(file: string, home: string): string {
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/**
 * The proposed edit for each missing or stale entry, for the wizard's
 * summary, beside the project's own lines: what it allows, and where it goes.
 * `replace` marks a stale entry, which is swapped rather than added.
 */
export function describeGlobalTrust(
  outcomes: readonly GlobalTrustOutcome[],
  home: string = homedir()
): { replace: boolean; what: string; where: string }[] {
  return outcomes
    .filter((outcome) => needsWrite(outcome))
    .map((outcome) => ({
      replace: outcome.state === "stale",
      what: `${BUILD_TRUST.packageName} at an exact version`,
      where: `in ${display(outcome.file, home)} (${outcome.key})`,
    }));
}

/**
 * A warning for each harness still missing its entry, or holding a stale one.
 * `installer` is the command a person runs, with no arguments, to get the
 * wizard that offers it.
 */
export function globalTrustWarnings(
  outcomes: readonly GlobalTrustOutcome[],
  installer: string,
  home: string = homedir()
): string[] {
  return outcomes
    .filter((outcome) => needsWrite(outcome) || outcome.state === "skipped")
    .map((outcome) => {
      const list = `the top-level \`${outcome.key}\` list in ${display(outcome.file, home)}`;
      const wizard = `run \`${installer}\` with no arguments in a terminal`;
      const fix =
        outcome.state === "stale"
          ? `The \`${BUILD_TRUST.label}\` entry in ${list} is out of date. Replace it with this one, or ${wizard}, which offers to replace it`
          : `To trust Taskless, add this entry to ${list}` +
            (outcome.state === "skipped"
              ? ` (left alone: ${outcome.skipped})`
              : "") +
            `, after "$defaults", or ${wizard}, which offers to add it`;
      return (
        `${outcome.harness} may refuse Taskless commands that the project rule allows: its safety classifier overrules project allow rules. ` +
        `${fix}:\n  ${GLOBAL_TRUST_ENTRY}`
      );
    });
}
