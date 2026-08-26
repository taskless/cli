import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PostHog } from "posthog-node";
import { decodeJwt } from "jose";

import { decodeOrgId, NIL_ORG_ID } from "./auth/jwt";
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

function isTelemetryDisabled(): boolean {
  return (
    process.env.TASKLESS_TELEMETRY_DISABLED === "1" ||
    process.env.DO_NOT_TRACK === "1"
  );
}

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

/**
 * Read `.taskless/taskless.json` and return its `version` field, or `0` if
 * the file is missing, unreadable, or has no numeric version. Called once at
 * telemetry init; the resolved value is attached as a super-property to every
 * subsequent event.
 */
async function resolveScaffoldVersion(
  cwd: string | undefined
): Promise<number> {
  if (!cwd) return 0;
  try {
    const content = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );
    const parsed = JSON.parse(content) as { version?: unknown };
    const version = Number(parsed.version);
    return Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
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

  if (isTelemetryDisabled()) {
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

    const scaffoldVersion = await resolveScaffoldVersion(cwd);

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
    const repository = cwd ? await resolveRepositoryContext(cwd) : undefined;
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
