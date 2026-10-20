import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
}

async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      cwd,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const error_ = error as ExecError;
    return {
      stdout: error_.stdout ?? "",
      stderr: error_.stderr ?? "",
      exitCode: error_.code ?? 1,
    };
  }
}

async function readJsonManifest(cwd: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(cwd, ".taskless", "taskless.json"), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("taskless onboard", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("bootstraps .taskless/ and prints the recipe on first run", async () => {
    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
    expect(stdout).toContain("## Goal");

    const manifest = await readJsonManifest(cwd);
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    // init/onboard alone should not record onboarded
    const install = manifest.install as { onboarded?: boolean } | undefined;
    expect(install?.onboarded).toBeUndefined();
  });

  it("refuses to print the recipe when install.onboarded is true", async () => {
    // Pre-populate the manifest with onboarded:true.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("already marked complete");
    expect(stdout).toContain("--force");
    expect(stdout).not.toContain("# Topic: onboard");
  });

  it("treats install.onboarded:false as not-onboarded and prints the recipe", async () => {
    // The 3-state semantics treat absent and false equivalently for gating
    // purposes; only true gates the recipe behind --force.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: false } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(["onboard", "-d", cwd], cwd);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
    expect(stdout).not.toContain("already marked complete");
  });

  it("--force prints the recipe even when onboarded:true", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(
      ["onboard", "--force", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("# Topic: onboard");
  });

  it("--mark-complete writes onboarded:true and preserves other fields", async () => {
    // Seed the manifest with an existing install and an unknown top-level
    // field; --mark-complete must not clobber either.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        version: 2,
        install: {
          cliVersion: "0.7.0",
          targets: { ".claude": { skills: ["taskless"], commands: ["tskl"] } },
        },
        experimental: { keep: "me" },
      }),
      "utf8"
    );

    const { stdout, exitCode } = await runCli(
      ["onboard", "--mark-complete", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Marked Taskless onboarding as complete");

    const manifest = await readJsonManifest(cwd);
    const install = manifest.install as {
      onboarded?: boolean;
      cliVersion?: string;
      targets?: Record<string, unknown>;
    };
    expect(install.onboarded).toBe(true);
    expect(install.cliVersion).toBe("0.7.0");
    expect(install.targets).toEqual({
      ".claude": { skills: ["taskless"], commands: ["tskl"] },
    });
    expect(manifest.experimental).toEqual({ keep: "me" });
  });

  it("--mark-complete is idempotent", async () => {
    const first = await runCli(["onboard", "--mark-complete", "-d", cwd], cwd);
    expect(first.exitCode).toBe(0);
    const afterFirst = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );

    const second = await runCli(["onboard", "--mark-complete", "-d", cwd], cwd);
    expect(second.exitCode).toBe(0);
    const afterSecond = await readFile(
      join(cwd, ".taskless", "taskless.json"),
      "utf8"
    );

    expect(afterSecond).toBe(afterFirst);
  });

  it("rejects --force --mark-complete with exit 1 and a clear error", async () => {
    const { stderr, exitCode } = await runCli(
      ["onboard", "--force", "--mark-complete", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--force");
    expect(stderr).toContain("--mark-complete");
  });

  it("`taskless agent onboard` matches the recipe printed by `taskless onboard --force`", async () => {
    // Pre-mark onboarded so the `onboard` path also prints the recipe via
    // --force, ensuring we compare recipe-vs-recipe rather than gate-vs-recipe.
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: { onboarded: true } }),
      "utf8"
    );

    const agentRecipe = await runCli(["agent", "onboard", "-d", cwd], cwd);
    const onboard = await runCli(["onboard", "--force", "-d", cwd], cwd);

    expect(agentRecipe.exitCode).toBe(0);
    expect(onboard.exitCode).toBe(0);
    expect(onboard.stdout.trim()).toBe(agentRecipe.stdout.trim());
  });
});

// #141: `taskless onboard` is the ONLY serving path for onboard.md — it is
// not a topic `agent` dispatches — so it must detect and pass the invocation
// itself. The byte-parity test above cannot catch a regression here: both
// paths spawn a bare `node dist/index.js`, under which detection correctly
// returns undefined for BOTH, so they agree on marker-filled output while
// taking different code paths. Only a launcher-shaped environment separates
// them.
describe("onboard renders a real invocation, not the agent-fill marker", () => {
  let cwd: string;

  // The env npx sets, per the observations behind `detectLauncher`.
  const npxEnvironment = {
    npm_config_user_agent: "npm/11.8.0 node/v24.13.1 darwin arm64",
    npm_lifecycle_event: "npx",
    npm_command: "exec",
  };

  async function runUnderNpx(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      env: { ...process.env, ...npxEnvironment },
    });
    return stdout;
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-invocation-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("resolves the invocation when launched through npx", async () => {
    const stdout = await runUnderNpx(["onboard", "-d", cwd]);

    expect(stdout).toContain("npx @taskless/cli");
    expect(stdout).not.toContain("<taskless-cli>");
  });

  it("agrees with `agent onboard` under the same launcher", async () => {
    // The parity the bare-spawn test intends to assert, under an environment
    // where the two paths can actually disagree.
    const viaOnboard = await runUnderNpx(["onboard", "--force", "-d", cwd]);
    const viaAgent = await runUnderNpx(["agent", "onboard", "-d", cwd]);

    expect(viaOnboard.trim()).toBe(viaAgent.trim());
  });
});

// #140: the bullet list is authored before anything establishes what this
// repository can express, so an unroutable candidate reaches the user looking
// exactly like a good one. These guard the ordering and the annotation that
// makes the difference visible — and the boundary that keeps `route`'s
// criterion from being copied into a second recipe that can drift from it.
describe("onboard recipe establishes the routing surface first", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-route-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("sends the agent to both `route` and `detect` before it proposes", async () => {
    const { stdout, exitCode } = await runCli(
      ["agent", "onboard", "-d", cwd],
      cwd
    );

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/agent route/);
    expect(stdout).toMatch(/detect --json/);
  });

  it("puts the routing step ahead of writing rules, not after it", async () => {
    // The ordering is the whole fix. A recipe that mentions `route` somewhere
    // is what shipped before; what matters is that it is read while the
    // candidates are still being decided.
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    const routing = stdout.indexOf("Learn the routing surface");
    const writing = stdout.indexOf("Write the rules");

    expect(routing).toBeGreaterThan(-1);
    expect(writing).toBeGreaterThan(-1);
    expect(routing).toBeLessThan(writing);
  });

  it("carries the destination in the bullet format", async () => {
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    expect(stdout).toContain("- <kebab-case-name> [<destination>]:");
    // The annotation is only useful if the agent knows the vocabulary, so the
    // recipe names the set rather than leaving it to be inferred.
    for (const destination of ["legacy", "sg", "vale", "runtime"]) {
      expect(stdout).toContain(`\`${destination}\``);
    }
  });

  it("defers the real decision to `route` rather than settling it here", async () => {
    const { stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd);

    expect(stdout).toContain("provisional");
    // `route.md` states the comparison is made there and only there. If this
    // recipe ever grows the destination table, this is what notices.
    expect(stdout).not.toContain("The rule is decided by");
    expect(stdout).not.toContain("create-remote-rule");
  });
});

// Topic v7: onboarding asks one question, runs logged out, completes itself,
// publishes a report, and ends on the CI offer. Each of these is a behavior an
// agent would otherwise improvise back toward the conversational v5 flow. v7
// adds the surfaced-counting method to the scan step, since the report recipe
// is only fetched after the mining it describes is over. v8 mines commit
// history for recurring fixes, which in a repository reviewed before its pull
// requests open is the only signal there is (#520), and keeps that evidence
// out of `surfaced`.
describe("onboard recipe asks one question and finishes on its own", () => {
  let cwd: string;
  let stdout: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-onboard-v6-"));
    ({ stdout } = await runCli(["agent", "onboard", "-d", cwd], cwd));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /** The text of one numbered step, from its title to the next title. */
  function step(title: string): string {
    const start = stdout.indexOf(title);
    expect(start).toBeGreaterThan(-1);
    const next = stdout.slice(start + title.length).search(/\n\d+\. \*\*/);
    return next === -1
      ? stdout.slice(start)
      : stdout.slice(start, start + title.length + next);
  }

  it("is topic v9", () => {
    expect(stdout).toMatch(/^# Topic: onboard {5}\(CLI v.+ \/ topic v9\)/m);
  });

  it("gives the method for counting surfaced while mining, not after", () => {
    const scan = step("Scan with high-signal filtering");
    expect(scan).toContain("merged in the");
    expect(scan).toContain("Bot and author comments count too");
    expect(scan).toContain("never by matching keywords");
    expect(scan).not.toMatch(/\bfixed\b/);
  });

  it("mines commit history for recurring fixes, but never counts it as surfaced", () => {
    const mine = step("Mine every source you can reach");
    expect(mine).toContain("**Commit history**");
    expect(mine.replaceAll(/\s+/g, " ")).toContain(
      "reviewed before its pull requests open"
    );
    const scan = step("Scan with high-signal filtering").replaceAll(
      /\s+/g,
      " "
    );
    expect(scan).toContain(
      "Evidence from commit history chooses candidates; it never counts toward these numbers"
    );
  });

  it("asks the one question, set apart, through a question tool when there is one", () => {
    const ask = step("Ask the one question");
    expect(ask).toContain(
      "\n\n   I'd look through your repo, your agent files such as CLAUDE.md, any documentation, relevant PRs if I have access, and any additional bug tracking that might help us build a set of rules. From this, I'll create starter rules in `.taskless/` (all local, no login) and then generate a report.\n\n   Do you want me to set up Taskless for you?\n\n"
    );
    expect(ask).toContain("Do not reword it, add to it");
    expect(ask).toContain("structured question tool");
    expect(ask.replaceAll(/\s+/g, " ")).toContain(
      "This is the only question you script."
    );
  });

  it("mines sources without asking which", () => {
    const mine = step("Mine every source you can reach");
    expect(mine).toContain("Do not ask the user which");
    expect(stdout).not.toContain("Are there other places I should look");
  });

  it("stays logged out and keeps runtime candidates for the report", () => {
    const flat = stdout.replaceAll(/\s+/g, " ");
    expect(flat).toContain("Onboarding runs logged out from start to finish");
    // Never an instruction to log in, only the one not to.
    expect(flat).not.toMatch(/(?<!not )run `?[^`]*auth login/);
    const write = step("Write the rules").replaceAll(/\s+/g, " ");
    expect(write).toContain("is not written");
    expect(write).toContain("Taskless Cloud candidate");
    expect(write).toContain("the report asks for that estimate");
  });

  it("limits clarifying questions to a refused report", () => {
    const clarify = step("Clarify only when stuck");
    expect(clarify).toContain("fewer than three working Taskless");
  });

  it("marks onboarding complete without asking", () => {
    const mark = step("Mark onboarding complete");
    expect(mark).toMatch(/onboard --mark-complete/);
    expect(mark).toContain("Do not ask first.");
  });

  it("publishes the report and sends feedback alongside it", () => {
    const publish = step("Publish the report, and send feedback alongside it");
    expect(publish).toMatch(/agent report`/);
    expect(publish).toMatch(/agent rule-feedback`/);
    expect(publish).toContain("ask the user nothing");
    expect(stdout.indexOf("Mark onboarding complete")).toBeLessThan(
      stdout.indexOf("Publish the report")
    );
  });

  it("ends on a strongly encouraged CI offer, with hooks as the fallback", () => {
    const ci = step("Make the case for CI, last");
    expect(stdout.indexOf("Publish the report")).toBeLessThan(
      stdout.indexOf("Make the case for CI")
    );
    expect(ci).toMatch(/agent ci`/);
    expect(ci).toContain("`ci` field of `detect --json`");
    expect(ci).toContain("Encourage it strongly");
    expect(ci).toMatch(/agent hooks`/);
  });

  it("names its neighbors in See Also", () => {
    const seeAlso = stdout.slice(stdout.indexOf("## See Also"));
    for (const topic of ["route", "report", "rule-feedback", "ci", "hooks"]) {
      expect(seeAlso).toMatch(new RegExp(`agent ${topic}\``));
    }
  });
});

// #393: the recipe now carries passages conditioned on what the host has on
// `PATH` and on whether the repository is on GitHub. `onboard` is not a topic
// `agent` dispatches to a shared detection step — each command detects for
// itself — so a state one computes and the other does not is exactly the
// regression byte-parity exists to catch, and the pre-existing parity test
// cannot see it: it runs in one state only.
async function repositoryWith(origin?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "taskless-onboard-tools-"));
  await execFileAsync("git", ["init", "-q"], { cwd: directory });
  if (origin !== undefined) {
    await execFileAsync("git", ["remote", "add", "origin", origin], {
      cwd: directory,
    });
  }
  return directory;
}

describe("the two serving paths agree in every host-tool state", () => {
  let cwd: string;

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function bothPaths(
    environment: NodeJS.ProcessEnv = {}
  ): Promise<[string, string]> {
    // `process.execPath` rather than `node`, so the PATH-less case below can
    // empty `PATH` without also losing the interpreter.
    const run = async (args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [binPath, ...args],
        { cwd, env: { ...process.env, ...environment } }
      );
      return stdout.trim();
    };
    return [
      await run(["onboard", "--force", "-d", cwd]),
      await run(["agent", "onboard", "-d", cwd]),
    ];
  }

  it("agrees, and offers the PR source, in a GitHub repository", async () => {
    cwd = await repositoryWith(
      "https://github.com/__taskless_test__/widgets.git"
    );

    const [viaOnboard, viaAgent] = await bothPaths();

    expect(viaOnboard).toBe(viaAgent);
    expect(viaOnboard).toContain("Taskless already looked");
  });

  it("agrees, and drops the PR source, outside GitHub", async () => {
    cwd = await repositoryWith(
      "https://gitlab.com/__taskless_test__/widgets.git"
    );

    const [viaOnboard, viaAgent] = await bothPaths();

    expect(viaOnboard).toBe(viaAgent);
    expect(viaOnboard).toContain("repository has no GitHub origin");
    expect(viaOnboard).not.toContain("**Recent PR review comments**: `gh` is");
  });

  it("agrees when PATH holds nothing at all", async () => {
    cwd = await repositoryWith(
      "https://github.com/__taskless_test__/widgets.git"
    );

    const [viaOnboard, viaAgent] = await bothPaths({ PATH: "" });

    expect(viaOnboard).toBe(viaAgent);
    expect(viaOnboard).toContain("`git`: not on your PATH");
    expect(viaOnboard).toContain("`jq`: not on your PATH");
    // `gh` reports INAPPLICABLE here, not merely absent, and that is correct
    // rather than a leak: with no `git` to run, the remote cannot be
    // resolved, `ghOwner` is the `[unknown]` sentinel, and the repository is
    // indistinguishable from one that is not on GitHub. The precedence rule
    // then picks the reason that installing something cannot fix, which is
    // the honest answer — nothing here established that there are PRs to
    // mine.
    expect(viaOnboard).toContain("`gh`: nothing to do here");
    expect(viaOnboard).not.toContain("command -v gh");
  });
});
