import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { runCommand } from "citty";

import { infoCommand } from "../src/commands/info";

/**
 * #641: `info` read `loggedIn` from whether a token existed, and every failed
 * identity check looked the same. A rejected token reported `loggedIn: true`
 * with no identity, and the human output said "not logged in" whether the
 * token was rejected or the service was down.
 */
describe("info: auth state", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-info-auth-"));
    process.env.TASKLESS_TOKEN = "test-token";
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TASKLESS_TOKEN;
    delete process.env.TASKLESS_API_URL;
    process.exitCode = undefined;
    await rm(cwd, { recursive: true, force: true });
  });

  /** Answer every whoami call with `response`. */
  function whoamiAnswers(response: () => Response): void {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const request = input instanceof Request ? input : new Request(input);
      if (new URL(request.url).pathname === "/cli/api/v2/whoami") {
        return Promise.resolve(response());
      }
      throw new Error(`unexpected request to ${request.url}`);
    });
  }

  async function infoJson(): Promise<Record<string, unknown>> {
    await runCommand(infoCommand, { rawArgs: ["--json", "-d", cwd] });
    const line = logSpy.mock.calls.at(-1)?.[0];
    return JSON.parse(String(line)) as Record<string, unknown>;
  }

  async function infoHuman(): Promise<string> {
    await runCommand(infoCommand, { rawArgs: ["-d", cwd] });
    return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
  }

  it("reports a rejected token as rejected, not logged in", async () => {
    whoamiAnswers(() =>
      Response.json({ error: "unauthorized" }, { status: 401 })
    );

    const json = await infoJson();
    expect(json).toMatchObject({ loggedIn: false, authState: "rejected" });
    expect(json.auth).toBeUndefined();

    const human = await infoHuman();
    expect(human).toContain("Auth: token rejected");
    expect(human).toContain("TASKLESS_TOKEN");
  });

  it("reports a network failure as unreachable, not as logged out", async () => {
    fetchMock.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      })
    );

    const json = await infoJson();
    expect(json).toMatchObject({ loggedIn: false, authState: "unreachable" });

    const human = await infoHuman();
    expect(human).toContain("Auth: could not reach Taskless");
    expect(human).toContain("connect ECONNREFUSED");
    expect(human).not.toContain("not logged in");
  });

  it("reports a refused CLI version as upgrade_required", async () => {
    whoamiAnswers(() =>
      Response.json({ error: "cli_upgrade_required" }, { status: 426 })
    );

    const json = await infoJson();
    expect(json).toMatchObject({
      loggedIn: false,
      authState: "upgrade_required",
    });
    expect(await infoHuman()).toContain("no longer supports this version");
  });

  it("reports an accepted token as authenticated, with its identity", async () => {
    whoamiAnswers(() =>
      Response.json({
        user: "octocat",
        email: "octo@example.com",
        orgs: [{ id: 1, name: "acme", url: "https://github.com/acme" }],
      })
    );

    const json = await infoJson();
    expect(json).toMatchObject({
      loggedIn: true,
      authState: "authenticated",
      auth: { user: "octocat", email: "octo@example.com", orgs: ["acme"] },
    });
    expect(await infoHuman()).toContain("Auth: logged in as octocat (acme)");
  });

  it("reports no token as none, without calling the service", async () => {
    delete process.env.TASKLESS_TOKEN;

    const json = await infoJson();
    expect(json).toMatchObject({ loggedIn: false, authState: "none" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports --anonymous as anonymous, without calling the service", async () => {
    await runCommand(infoCommand, {
      rawArgs: ["--json", "--anonymous", "-d", cwd],
    });
    const json = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({ loggedIn: false, authState: "anonymous" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
