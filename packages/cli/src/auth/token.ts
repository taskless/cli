import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";

import { addToGitignore } from "../filesystem/gitignore";
import { getCliPrefix } from "../util/package-manager";

const PER_REPO_AUTH_FILE = ".env.local.json";

/** Resolve the XDG-compliant config directory for taskless */
export function getConfigDirectory(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgHome, "taskless");
}

/**
 * Resolve the current access token.
 * Priority: TASKLESS_TOKEN env var > per-repo .taskless/.env.local.json
 */
export async function getToken(
  cwd?: string,
  options?: { silent?: boolean }
): Promise<string | undefined> {
  const envToken = process.env.TASKLESS_TOKEN;
  if (envToken) return envToken;

  // Per-repo token
  if (cwd) {
    const token = await readPerRepoToken(cwd);
    if (token) {
      if (!options?.silent) await warnIfTracked(cwd);
      return token;
    }
  }

  // Check for legacy global token and warn
  if (!options?.silent) warnIfLegacyToken();

  return undefined;
}

/** Whether `getToken` answers from the `TASKLESS_TOKEN` environment variable. */
export function isEnvironmentToken(): boolean {
  return Boolean(process.env.TASKLESS_TOKEN);
}

/**
 * What to do about a token the service rejected (a `401`), as a sentence that
 * follows "Authentication was rejected." or stands as a remedy on its own.
 *
 * A token from `TASKLESS_TOKEN` is out of reach of `auth login` and
 * `auth logout`, so the variable itself is the fix. A saved token is replaced
 * by `auth login`, which re-authenticates when the service rejects the token
 * it finds rather than refusing because one is present.
 */
export function rejectedTokenRemedy(): string {
  return isEnvironmentToken()
    ? "The token comes from the TASKLESS_TOKEN environment variable, so replace or unset it; `auth login` and `auth logout` do not change it."
    : `Run \`${getCliPrefix()} auth login\` to replace the saved token.`;
}

/** Save token data to per-repo .taskless/.env.local.json */
export async function saveToken(
  data: {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
  },
  cwd?: string
): Promise<void> {
  if (!cwd) return;

  // Convert relative expires_in (seconds) to absolute expires_at (ms epoch)
  const persisted: Record<string, unknown> = { ...data };
  if (
    typeof data.expires_in === "number" &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
  ) {
    persisted.expires_at = Date.now() + data.expires_in * 1000;
  }

  const content = JSON.stringify(persisted, null, 2) + "\n";

  const tasklessDirectory = join(cwd, ".taskless");
  await mkdir(tasklessDirectory, { recursive: true });
  await addToGitignore(cwd, [PER_REPO_AUTH_FILE]);
  await writeFile(join(tasklessDirectory, PER_REPO_AUTH_FILE), content, {
    mode: 0o600,
  });
}

/** Remove saved token from per-repo .taskless/.env.local.json */
export async function removeToken(cwd?: string): Promise<boolean> {
  if (!cwd) return false;

  try {
    await rm(join(cwd, ".taskless", PER_REPO_AUTH_FILE));
    return true;
  } catch {
    return false;
  }
}

async function readPerRepoToken(cwd: string): Promise<string | undefined> {
  try {
    const filePath = join(cwd, ".taskless", PER_REPO_AUTH_FILE);
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as {
      access_token?: string;
      expires_at?: number;
    };

    const expiresAt = data.expires_at;
    if (
      typeof expiresAt === "number" &&
      Number.isFinite(expiresAt) &&
      Date.now() >= expiresAt
    ) {
      return undefined;
    }

    return data.access_token;
  } catch {
    return undefined;
  }
}

let legacyWarningShown = false;

/** Warn once if a legacy global auth.json exists but is no longer used */
function warnIfLegacyToken(): void {
  if (legacyWarningShown) return;
  const legacyPath = join(getConfigDirectory(), "auth.json");
  if (existsSync(legacyPath)) {
    legacyWarningShown = true;
    console.error(
      `Notice: Found legacy global auth at ${legacyPath}. Global tokens are no longer used. Run \`${getCliPrefix()} auth login\` to authenticate for this repository.`
    );
  }
}

/** Warn if .env.local.json is tracked by git */
async function warnIfTracked(cwd: string): Promise<void> {
  const relativePath = `.taskless/${PER_REPO_AUTH_FILE}`;
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile("git", ["ls-files", relativePath], { cwd }, (error, stdout) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
    if (output.length > 0) {
      // Already in the index, so a .gitignore entry alone changes nothing:
      // git keeps tracking a file it already tracks.
      const cli = getCliPrefix();
      console.error(
        [
          `Warning: ${relativePath} is tracked by git. It contains an authentication token.`,
          `  1. Untrack it and keep your local copy: git rm --cached ${relativePath}`,
          `  2. Make sure .taskless/.gitignore lists ${PER_REPO_AUTH_FILE}, then commit.`,
          `  3. If a commit containing it was pushed, treat the token as exposed and replace it: \`${cli} auth logout\`, then \`${cli} auth login\`. Logout only deletes the local copy, so it does not revoke the old token.`,
        ].join("\n")
      );
    }
  } catch {
    // git not available or not a repo — skip the check
  }
}
