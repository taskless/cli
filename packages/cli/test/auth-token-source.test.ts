import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

// `auth login` and `auth logout` only manage the saved token. When the token
// comes from TASKLESS_TOKEN instead, neither can change it, and both used to
// answer as if no token existed at all, so nothing pointed at the variable.
describe("auth commands with TASKLESS_TOKEN set", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-auth-token-source-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function runAuth(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(
      "node",
      [binPath, "auth", ...args, "-d", cwd],
      { env: { ...process.env, TASKLESS_TOKEN: "env-token" } }
    );
    return stdout;
  }

  it("logout says the variable is still used", async () => {
    const stdout = await runAuth(["logout"]);

    expect(stdout).toContain("No saved login to remove.");
    expect(stdout).toContain("TASKLESS_TOKEN is set in the environment");
    expect(stdout).not.toContain("Not logged in.");
  });

  it("login names the variable instead of sending the user to logout", async () => {
    const stdout = await runAuth(["login"]);

    expect(stdout).toContain("TASKLESS_TOKEN");
    expect(stdout).not.toContain("auth logout");
  });
});
