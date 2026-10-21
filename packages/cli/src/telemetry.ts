import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { PostHog } from "posthog-node";
import { decodeJwt } from "jose";

import { decodeOrgId, NIL_ORG_ID } from "./auth/jwt";
import { resolveAdoptionDimensions } from "./util/adoption-dimensions";
import { resolveRepositoryContext, UNKNOWN_GH_OWNER } from "./util/git-remote";
import { getConfigDirectory, getToken } from "./auth/token";
import { CLI_VERSION } from "./version";

const POSTHOG_PROJECT_TOKEN =
  "phc_stymptTiUskp4zM3m9StNSGheHwjskaYagpxV7rDjZyc";
const POSTHOG_HOST = "https://z.taskless.io";

const ANONYMOUS_ID_FILE = "anonymous_id";

export interface TelemetryClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  shutdown(): Promise<void>;
}

/**
 * Resolve the current auth identity by reading the token fresh. Unlike the
 * telemetry client's cached identity (fixed at init), this reflects the state
 * AT CALL TIME — so the runner can stamp cli_run with the post-invocation
 * identity even for commands that change auth state mid-run (auth login/logout).
 */
export async function resolveRunIdentity(
  cwd?: string
): Promise<{ anonymous: boolean; loggedIn: boolean }> {
  try {
    const token = await getToken(cwd, { silent: true });
    if (!token) return { anonymous: true, loggedIn: false };
    // A token is present → logged in. anonymous tracks whether a subject
    // (authenticated identity) decoded from it.
    return { anonymous: decodeSubject(token) === undefined, loggedIn: true };
  } catch {
    return { anonymous: true, loggedIn: false };
  }
}

function isDisabledByEnvironment(): boolean {
  return (
    process.env.TASKLESS_TELEMETRY_DISABLED === "1" ||
    process.env.DO_NOT_TRACK === "1"
  );
}

/**
 * Whether the project's manifest opts out with `"telemetry": false`. Only the
 * literal `false` counts, matching the env opt-outs, which accept only `"1"`.
 *
 * The manifest is checked in, so this turns telemetry off for everyone working
 * in the repository. That is the point of putting it there rather than in the
 * environment.
 */
function isDisabledByManifest(manifest: ProjectManifest | undefined): boolean {
  return manifest?.telemetry === false;
}

/**
 * Whether captures reach PostHog at all. The same predicates that hand out
 * the no-op client, exposed so a caller that must NOT do work under the
 * opt-out (the survey invite, which has nowhere to send an answer) asks this
 * rather than restating them. Pass `cwd` so the project's manifest opt-out is
 * honored; without it only the environment is consulted.
 */
export async function isTelemetryEnabled(cwd?: string): Promise<boolean> {
  if (isDisabledByEnvironment()) return false;
  return !isDisabledByManifest(await readProjectManifest(cwd));
}

/**
 * Said once per install, by the wizard and by `init --no-interactive`, which
 * are where a person (or the agent acting for one) is told what the CLI does.
 * Both skip it when telemetry is already off: there is nothing to opt out of,
 * and naming the switches would read as though it were still on.
 */
export const TELEMETRY_NOTICE =
  "Taskless collects anonymous telemetry to help us learn how the CLI is being used.\n" +
  "You can opt out with `TASKLESS_TELEMETRY_DISABLED=1`\n" +
  'or by setting `"telemetry": false` in `.taskless/taskless.json`.';

/** The heading the wizard shows {@link TELEMETRY_NOTICE} under. */
export const TELEMETRY_NOTICE_TITLE = "Telemetry Information";

const noopClient: TelemetryClient = {
  capture() {},
  async shutdown() {},
};

async function getOrCreateAnonymousId(): Promise<string> {
  const configDirectory = getConfigDirectory();
  const filePath = join(configDirectory, ANONYMOUS_ID_FILE);

  try {
    const existing = await readFile(filePath, "utf8");
    const trimmed = existing.trim();
    // Validate it looks like a UUID
    if (
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        trimmed
      )
    ) {
      return trimmed;
    }
  } catch {
    // File doesn't exist or can't be read
  }

  // Generate a new UUID and persist it
  const id = randomUUID();
  try {
    await mkdir(configDirectory, { recursive: true });
    await writeFile(filePath, id, { mode: 0o600 });
  } catch {
    // Best-effort persistence — continue with the generated ID
  }
  return id;
}

function decodeSubject(token: string): string | undefined {
  try {
    const claims = decodeJwt(token);
    return typeof claims.sub === "string" ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

/** The two fields of `.taskless/taskless.json` telemetry reads. */
interface ProjectManifest {
  version?: unknown;
  telemetry?: unknown;
}

/**
 * Read `.taskless/taskless.json`, or `undefined` if there is no `cwd` or the
 * file is missing, unreadable, or not an object. Deliberately not
 * `readRawManifest`, which throws on an unreadable file: telemetry failures
 * are silent, and a broken manifest is reported by the command that needs it.
 */
async function readProjectManifest(
  cwd: string | undefined
): Promise<ProjectManifest | undefined> {
  if (!cwd) return undefined;
  try {
    const content = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ProjectManifest)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The manifest's `version` field, or `0` if it is absent or not numeric.
 * Resolved once at telemetry init and attached as a super-property to every
 * subsequent event.
 */
function resolveScaffoldVersion(manifest: ProjectManifest | undefined): number {
  const version = Number(manifest?.version);
  return Number.isFinite(version) ? version : 0;
}

let instance: TelemetryClient | undefined;

/**
 * Shut down the telemetry client if it was previously initialized.
 * No-op if getTelemetry() was never called (avoids lazy init just to shut down).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (instance) {
    await instance.shutdown();
  }
}

/**
 * Get the telemetry client, lazily initializing on first call.
 * Subsequent calls return the same instance (cwd is only used on first init).
 */
export async function getTelemetry(cwd?: string): Promise<TelemetryClient> {
  if (instance) return instance;

  // The environment first, since it costs nothing; the manifest read is the
  // only filesystem work either opt-out is allowed to do.
  if (isDisabledByEnvironment()) {
    instance = noopClient;
    return instance;
  }
  const manifest = await readProjectManifest(cwd);
  if (isDisabledByManifest(manifest)) {
    instance = noopClient;
    return instance;
  }

  let posthog: PostHog | undefined;
  try {
    const anonymousId = await getOrCreateAnonymousId();

    // Resolve identity: prefer JWT subject, fall back to anonymous ID
    let distinctId = anonymousId;
    let anonymous = true;
    // The org's canonical id — the field we always identify on. May be a string
    // (UUID) or a number, so it is stringified only at the group boundary. When
    // logged in but no org resolves, it falls back to the known nil-UUID so
    // authenticated events always carry a stable org group.
    let orgSubject: string | number | undefined;

    const token = await getToken(cwd, { silent: true });
    if (token) {
      const sub = decodeSubject(token);
      if (sub) {
        distinctId = sub;
        anonymous = false;
      }
      orgSubject = decodeOrgId(token) ?? NIL_ORG_ID;
    }

    // These two are independent of each other and each spawns a subprocess
    // or reads the filesystem, so they run concurrently rather than in a
    // chain. `getTelemetry` runs on essentially every invocation, and this was
    // three sequential git/fs round trips in front of every command.
    //
    // Everything here runs only when telemetry is enabled: the opt-outs return
    // the no-op client before `getTelemetry` reaches this point, so
    // `DO_NOT_TRACK=1` or `"telemetry": false` costs no git spawn and no
    // filesystem probe beyond the manifest read. The opt-out has to be an
    // opt-out of the WORK, not only of the send.
    const scaffoldVersion = resolveScaffoldVersion(manifest);
    const [repository, dimensions] = await Promise.all([
      // Which GitHub owner is using the CLI, including anonymously — see the
      // note below on why this is resolved from the git remote.
      cwd ? resolveRepositoryContext(cwd) : undefined,
      // The adoption dimensions: workspace and repository identity, execution
      // environment, and language stack. Resolved ONCE, like `cliVersion` and
      // `scaffoldVersion`, and attached to identify and to every capture. It
      // handles an absent `cwd` itself, sentinelling only the three dimensions
      // that depend on one.
      resolveAdoptionDimensions(cwd),
    ]);

    // Which GitHub owner is using the CLI, including anonymously — that is
    // the question this property exists to answer, so it is resolved from the
    // git remote rather than from the token, and is present whether or not
    // one was found.
    //
    // `ghOwner`, not `ghOrg`: the first path segment of a GitHub URL is an
    // organization OR a user account, and telling them apart needs an
    // authenticated API call an anonymous run cannot make. The name states
    // what is actually in hand.
    //
    // camelCase because it is a PROPERTY. Event names are snake_case here
    // (`cli_run`, `cli_check_completed`) and properties are camelCase
    // (`cliVersion`, `durationMs`, `errorCount`). This shipped as `gh_owner`
    // by mistake and is corrected before it reaches a stable release.
    //
    // `[unknown]` rather than an omitted property, so runs with no resolvable
    // owner stay countable instead of vanishing from aggregates. Resolution
    // never throws, so a host with no git installed lands here like any other
    // unresolvable case. No `cwd` is treated the same way, matching
    // `resolveScaffoldVersion` above; every real call site passes one.
    const ghOwner = repository ? repository.ghOwner : UNKNOWN_GH_OWNER;

    posthog = new PostHog(POSTHOG_PROJECT_TOKEN, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });

    // Identify the user/device
    posthog.identify({
      distinctId,
      properties: {
        cli: anonymousId,
        cliVersion: CLI_VERSION,
        scaffoldVersion,
        ghOwner,
        ...dimensions,
      },
    });

    // Group identify for authenticated users with an org
    if (!anonymous && orgSubject !== undefined) {
      posthog.groupIdentify({
        groupType: "organization",
        groupKey: String(orgSubject),
      });
    }

    const ph = posthog;
    instance = {
      capture(event: string, properties?: Record<string, unknown>) {
        try {
          ph.capture({
            distinctId,
            event,
            properties: {
              ...properties,
              cli: anonymousId,
              cliVersion: CLI_VERSION,
              scaffoldVersion,
              ghOwner,
              ...dimensions,
            },
            ...(!anonymous && orgSubject !== undefined
              ? { groups: { organization: String(orgSubject) } }
              : {}),
          });
        } catch {
          // Telemetry failures are silent
        }
      },
      async shutdown() {
        try {
          await ph.shutdown();
        } catch {
          // Telemetry failures are silent
        }
      },
    };
  } catch {
    // Clean up partially-created client to avoid open handles
    if (posthog) {
      try {
        await posthog.shutdown();
      } catch {
        // Best-effort cleanup
      }
    }
    instance = noopClient;
  }

  return instance;
}
