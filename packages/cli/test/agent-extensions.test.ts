import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildInvocation } from "../src/util/invocation";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout: string;
      stderr: string;
      code: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

describe("taskless agent (no args)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("prints the human slug", async () => {
    const result = await runCli(["agent", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("For agents:");
    expect(result.stdout).toContain("For humans:");
  });

  it("points humans at this build's own invocation", async () => {
    // The hint goes through `applyCliInvocation`, so a nightly names itself
    // rather than sending the reader to the released package. A prod build
    // rewrites to the same string, which is why the sibling ast-grep rule
    // `no-unrouted-cli-invocation` is what actually guards the routing.
    const result = await runCli(["agent", "-d", cwd]);
    expect(result.stdout).toContain(`\`${buildInvocation()}\` (no args)`);
  });

  it("prints the topic table including all expected topics", async () => {
    const result = await runCli(["agent", "-d", cwd]);
    expect(result.stdout).toContain("Topics:");
    for (const topic of ["init", "info", "check", "auth", "rule"]) {
      expect(result.stdout).toContain(topic);
    }
  });

  it("mentions the --anonymous flag", async () => {
    const result = await runCli(["agent", "-d", cwd]);
    expect(result.stdout).toContain("--anonymous");
  });

  it("lists the routing recipe topics under Authoring recipes", async () => {
    const result = await runCli(["agent", "-d", cwd]);
    expect(result.stdout).toContain("Authoring recipes:");
    for (const topic of [
      "route",
      "create-legacy-rule",
      "create-sg-rule",
      "create-vale-rule",
      "create-runtime-rule",
      "create-remote-rule",
    ]) {
      expect(result.stdout).toContain(topic);
    }
  });

  it("no longer advertises the removed topic names", async () => {
    const result = await runCli(["agent", "-d", cwd]);
    // `static`/`existing`/`remote` were renamed and `engine-selection` was
    // merged into `route`. Listing a name that resolves to nothing is worse
    // than not listing it — the agent spends a fetch to learn it is gone.
    for (const removed of ["engine-selection", "  existing", "  static"]) {
      expect(result.stdout).not.toContain(removed);
    }
  });
});

describe("taskless agent <routing topic>", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-routing-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it.each([
    "route",
    "create-legacy-rule",
    "create-sg-rule",
    "create-vale-rule",
    "create-runtime-rule",
    "create-remote-rule",
  ])("resolves the %s recipe without an unknown-topic error", async (topic) => {
    const result = await runCli(["agent", topic, "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`# Topic: ${topic}`);
    expect(result.stdout).toContain("## Goal");
    expect(result.stderr).not.toContain("Unknown command");
  });

  // D9: a reader who arrived at the wrong recipe should find that out in the
  // first line, where recovery is a re-decision, rather than after authoring
  // the wrong artifact. Fixed shape across all five so it is recognisable.
  it.each([
    "create-legacy-rule",
    "create-sg-rule",
    "create-vale-rule",
    "create-runtime-rule",
    "create-remote-rule",
  ])("opens %s with the orientation banner", async (topic) => {
    const result = await runCli(["agent", topic, "-d", cwd]);
    expect(result.stdout).toContain("## You are here");
    expect(result.stdout).toContain(`This is \`${topic}\`.`);
    // Recipes name the CLI through `%(TASKLESS_CLI)s`, which renders as the
    // agent-fill marker here: this is a prod build spawned as `node dist/…`,
    // so nothing knows which launcher the reader has.
    expect(result.stdout).toContain("`<taskless-cli> agent route`");
  });

  it.each(["existing", "static", "remote", "engine-selection", "rule-create"])(
    "no longer resolves the removed topic %s",
    async (topic) => {
      const result = await runCli(["agent", topic, "-d", cwd]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Unknown command");
    }
  );
});

describe("taskless agent <topic>", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-topic-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns the canonical recipe for a known topic", async () => {
    const result = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Topic: create-remote-rule");
    expect(result.stdout).toContain("## Goal");
    expect(result.stdout).toContain("## Steps");
  });

  it("interpolates %(CLI_VERSION)s in the recipe header", async () => {
    const result = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    // Should contain a version pattern, not the literal placeholder.
    // Guard against both the legacy mustache syntax and the current
    // sprintf-js named-arg syntax leaking through.
    expect(result.stdout).not.toContain("{{CLI_VERSION}}");
    expect(result.stdout).not.toContain("%(CLI_VERSION)s");
    expect(result.stdout).toMatch(/CLI v\d+\.\d+\.\d+/);
  });

  it("interpolates %(INPUT_SCHEMA)s for topics with a Zod input", async () => {
    const result = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    expect(result.stdout).not.toContain("{{INPUT_SCHEMA}}");
    expect(result.stdout).not.toContain("%(INPUT_SCHEMA)s");
    // Embedded schema includes the JSON Schema $schema URI
    expect(result.stdout).toContain('"$schema"');
    expect(result.stdout).toContain('"prompt"');
    expect(result.stdout).toContain('"successCases"');
  });

  it("renders %(PACKAGE_MANAGER_DLX)s as the agent-fill marker", async () => {
    const result = await runCli(["agent", "ci", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    // Sprintf substitutes the placeholder; the agent-fill marker should
    // appear in its rendered <package-manager-dlx> form, never as the
    // raw sprintf placeholder.
    expect(result.stdout).not.toContain("%(PACKAGE_MANAGER_DLX)s");
    expect(result.stdout).not.toContain("{{PACKAGE_MANAGER_DLX}}");
    expect(result.stdout).toContain("<package-manager-dlx>");
  });

  it("exits 1 for an unknown topic", async () => {
    const result = await runCli(["agent", "totally-unknown", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown command");
  });

  it("points an unknown topic at `taskless agent`, not the removed command", async () => {
    const result = await runCli(["agent", "totally-unknown", "-d", cwd]);
    expect(result.stderr).toContain("Run `taskless agent` for available");
  });

  // A topic is one token. The old resolver joined positionals, so
  // `rule create` and `create rule` both reached `rule-create.txt` — which
  // invited an agent to paraphrase a topic name and still get a hit. Extra
  // positionals are now an error rather than something to guess at.
  it("rejects a multi-token topic instead of joining the positionals", async () => {
    const result = await runCli(["agent", "rule", "create", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("# Topic:");
    expect(result.stderr).toContain("Too many arguments");
    expect(result.stderr).toContain("A topic is a single token");
  });
});

describe("taskless agent --anonymous (variant lookup)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-anon-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns the .anonymous variant when one exists (improve-rule)", async () => {
    const result = await runCli([
      "agent",
      "improve-rule",
      "--anonymous",
      "-d",
      cwd,
    ]);
    expect(result.exitCode).toBe(0);
    // The anonymous recipe declares "(anonymous)" in its header
    expect(result.stdout).toContain("(anonymous)");
  });

  it("falls back to the canonical recipe when no variant exists (check)", async () => {
    const canonical = await runCli(["agent", "check", "-d", cwd]);
    const anonymous = await runCli([
      "agent",
      "check",
      "--anonymous",
      "-d",
      cwd,
    ]);
    expect(anonymous.exitCode).toBe(0);
    // Same body — falls back to check.txt since no check.anonymous.txt
    expect(anonymous.stdout).toBe(canonical.stdout);
  });

  // `rule-create.anonymous.txt` used to be the local-only variant of the
  // service recipe, which duplicated `static.txt` outright. `create-sg-rule`
  // now *is* that path, so an `--anonymous` variant of the remote recipe would
  // be "the local version of the remote one" — the contradiction `route`
  // resolves. It falls back to the canonical text instead.
  it("has no anonymous variant of the service recipe", async () => {
    const canonical = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    const anonymous = await runCli([
      "agent",
      "create-remote-rule",
      "--anonymous",
      "-d",
      cwd,
    ]);
    expect(anonymous.exitCode).toBe(0);
    expect(anonymous.stdout).toBe(canonical.stdout);
    expect(anonymous.stdout).not.toContain("(anonymous)");
  });

  it("returns the canonical recipe when --anonymous is omitted", async () => {
    const result = await runCli(["agent", "improve-rule", "-d", cwd]);
    expect(result.stdout).toContain("# Topic: improve-rule");
    expect(result.stdout).not.toContain("(anonymous)");
  });
});

describe("bare taskless (non-TTY) routes to the agent index", () => {
  it("prints the non-interactive preamble + topic index", async () => {
    // execFile gives no TTY, which triggers the routing. No flags so
    // citty doesn't try to forward them to the agent subcommand.
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("non-interactive context detected");
    expect(result.stdout).toContain("Topics:");
  });
});

// D1: `engine-selection` was merged into `route`, so the engine reasoning it
// carried has to still be reachable — from one fetch instead of two. These are
// the assertions that used to guard the standalone topic, re-pointed at the
// recipe that now owns them.
describe("taskless agent route (absorbed engine reasoning)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-agent-route-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("puts the evidence before the destination", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("before you name a destination");
  });

  it("carries the boundary cases", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    // Each is a wrong answer someone actually reaches for.
    expect(result.stdout).toContain("Prose about code is still prose");
    expect(result.stdout).toContain("one document at a time");
    expect(result.stdout).toContain("Trust tier is not a destination");
  });

  it("states the ambiguity default as a property, not as `sg`", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    // "choose an engine whose availability you can assert" stays correct on an
    // unsupported arch and server-side alike; naming `sg` outright would be
    // false on the host where `sg` is the missing one.
    expect(result.stdout).toContain("whose availability you can");
    expect(result.stdout).toContain("There is no fixed fallback");
  });

  it("weighs the concrete form above the wording of the request", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.stdout).toContain("outranks how the request was");
  });

  it("names all five destinations", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    for (const destination of [
      "create-legacy-rule",
      "create-sg-rule",
      "create-vale-rule",
      "create-runtime-rule",
      "create-remote-rule",
    ]) {
      expect(result.stdout).toContain(destination);
    }
  });

  it("splits the runtime destination on login state", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    // D7: reading login state early is what makes the destination set correct.
    expect(result.stdout).toContain("info --json");
    expect(result.stdout).toContain("logged out");
  });

  it("sends the reader to a command rather than a category", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.stdout).toMatch(/agent create-vale-rule/);
  });

  it("follows the recipe header and section convention", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.stdout).toContain("# Topic: route");
    for (const section of [
      "## Goal",
      "## Preconditions",
      "## Steps",
      "## See Also",
    ]) {
      expect(result.stdout).toContain(section);
    }
  });
});

/**
 * The two guards for #179. `route` omitting the destination is the good path;
 * the recipe's own check is what holds when an agent reaches it directly, from
 * a cached plan, or from routing guidance older than the constraint. Neither
 * is sufficient alone: the first is advisory, the second is late.
 */
describe("the GitHub-owner constraint is guarded twice", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-ghguard-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("route reads ghOwner from the info call it already makes", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ghOwner");
    // Read from the payload, not re-derived, so the offer matches what the
    // CLI enforces.
    expect(result.stdout).toContain("rather than running `git` yourself");
  });

  it("route drops remote generation when there is no owner", async () => {
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.stdout).toContain("Drop remote generation");
    expect(result.stdout).toContain("[unknown]");
  });

  it("route says the omission is not fixable by logging in", async () => {
    // The failure most likely to be misread as an auth problem. An agent that
    // sends the user to `auth login` wastes a turn and lands back here.
    const result = await runCli(["agent", "route", "-d", cwd]);
    expect(result.stdout).toContain("not fixed by `auth login`");
  });

  it("the remote recipe guards the constraint itself", async () => {
    const result = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Check the GitHub owner first");
    expect(result.stdout).toContain("ghOwner");
    // Stop before the expensive part, not after it.
    expect(result.stdout).toContain("stop here");
  });

  it("the remote recipe does not send the user to auth login for it", async () => {
    const result = await runCli(["agent", "create-remote-rule", "-d", cwd]);
    expect(result.stdout).toContain("`auth login` does not fix it");
  });

  // `rule improve` goes through the same service path and raises the same
  // three codes, so its recipe carries the same contract. The first version of
  // this change updated only `create-remote-rule`, and nothing caught it: the
  // test above names one recipe, so it could not.
  it.each(["create-remote-rule", "improve-rule"])(
    "%s documents every code the populations raise",
    async (topic) => {
      const result = await runCli(["agent", topic, "-d", cwd]);
      expect(result.exitCode).toBe(0);
      for (const code of [
        "NOT_A_GIT_REPOSITORY",
        "NO_ORIGIN_REMOTE",
        "UNSUPPORTED_REMOTE_HOST",
        // Retained for compatibility, so it must stay documented too.
        "NO_GITHUB_REMOTE",
      ]) {
        expect(result.stdout).toContain(code);
      }
    }
  );

  it.each(["create-remote-rule", "improve-rule"])(
    "%s says auth login does not fix a missing owner",
    async (topic) => {
      const result = await runCli(["agent", topic, "-d", cwd]);
      expect(result.stdout).toMatch(/`auth login` (does not|cannot) fix/);
    }
  );
});

/**
 * The two shapes that verify clean and report nothing forever. Both cost real
 * time to diagnose while building the matching-semantics differential, and
 * neither was written down anywhere.
 */
describe("create-sg-rule warns about silently inert relational rules", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-sg-inert-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("says a sibling relation needs stopBy to cross punctuation", async () => {
    const result = await runCli(["agent", "create-sg-rule", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stopBy: end` to cross punctuation");
    // The reason, not just the fix: the separator is a node too.
    expect(result.stdout).toContain("the separators are nodes too");
  });

  it("says a not over the binding subtree excludes everything", async () => {
    const result = await runCli(["agent", "create-sg-rule", "-d", cwd]);
    expect(result.stdout).toContain("excludes everything");
    expect(result.stdout).toContain("its own descendant");
  });

  it("frames both as reporting nothing rather than erroring", async () => {
    // The dangerous property: zero findings is what a clean codebase looks
    // like, so neither failure announces itself.
    const result = await runCli(["agent", "create-sg-rule", "-d", cwd]);
    expect(result.stdout).toContain("reads exactly like a clean codebase");
  });
});
