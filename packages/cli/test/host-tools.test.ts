import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { detectHostTools } from "../src/detect/host-tools";
import { getRecipe, type HostTool } from "../src/prompts/recipes";

const execFileAsync = promisify(execFile);

/** A repository with the given `origin`, or none when `origin` is undefined. */
async function makeRepository(origin?: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "taskless-host-tools-"));
  await execFileAsync("git", ["init", "-q"], { cwd });
  if (origin !== undefined) {
    await execFileAsync("git", ["remote", "add", "origin", origin], { cwd });
  }
  return cwd;
}

describe("detectHostTools", () => {
  const originalPath = process.env.PATH;
  let cwd: string;

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(cwd, { recursive: true, force: true });
  });

  it("reports a tool on PATH as present, with where it was found", async () => {
    cwd = await makeRepository("https://github.com/acme/widgets.git");

    const tools = await detectHostTools(cwd);
    const git = tools.find((tool) => tool.name === "git");

    // `git` is on PATH by construction: the fixture above was built with it.
    expect(git?.present).toBe(true);
    expect(git?.path).toBeTypeOf("string");
    expect(git?.applicable).toBe(true);
  });

  it("reports every tool absent when PATH holds nothing", async () => {
    cwd = await makeRepository("https://github.com/acme/widgets.git");
    process.env.PATH = "";

    const tools = await detectHostTools(cwd);

    expect(tools.map((tool) => tool.name)).toEqual(["gh", "git", "jq"]);
    for (const tool of tools) {
      expect(tool.present).toBe(false);
      // No `path` key at all rather than an empty string: a consumer
      // rendering "found at <path>" must not be handed a falsy path to
      // interpolate.
      expect(tool.path).toBeUndefined();
    }
  });

  it("marks gh inapplicable outside a GitHub repository, and says nothing about the others", async () => {
    cwd = await makeRepository("https://gitlab.com/acme/widgets.git");

    const tools = await detectHostTools(cwd);

    expect(tools.find((tool) => tool.name === "gh")?.applicable).toBe(false);
    // `git` and `jq` do not care what the remote is.
    expect(tools.find((tool) => tool.name === "git")?.applicable).toBe(true);
    expect(tools.find((tool) => tool.name === "jq")?.applicable).toBe(true);
  });

  it("marks gh inapplicable in a directory that is not a repository", async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-host-tools-bare-"));

    const tools = await detectHostTools(cwd);

    expect(tools.find((tool) => tool.name === "gh")?.applicable).toBe(false);
  });

  // CI runs `ubuntu-latest` only, so a Windows regression here is invisible
  // unless the platform is stubbed. `findOnPath` does an exact `existsSync`
  // against each `PATH` entry and consults no `PATHEXT`, so detection must go
  // through `executableName` or a Windows user with `gh.exe` installed is told
  // to install the GitHub CLI they already have.
  it("finds a .exe on a win32 host", async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-host-tools-win-"));
    await writeFile(join(cwd, "gh.exe"), "", "utf8");
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    // `;` because `findOnPath` splits on the win32 separator once the platform
    // says win32 — the two have to agree or the fixture tests nothing.
    process.env.PATH = cwd;

    try {
      const tools = await detectHostTools(cwd);
      const gh = tools.find((tool) => tool.name === "gh");

      expect(gh?.present).toBe(true);
      expect(gh?.path).toBe(join(cwd, "gh.exe"));
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });

  // The precedence rule, at the layer that produces it: `present` and
  // `applicable` are independent, so an installed `gh` in a non-GitHub
  // repository must report BOTH true and false rather than being flattened
  // into "missing". Flattening is what produces the one instruction that
  // cannot help this user — "install gh".
  it("keeps present and applicable independent", async () => {
    cwd = await makeRepository("https://gitlab.com/acme/widgets.git");

    const tools = await detectHostTools(cwd);
    const gh = tools.find((tool) => tool.name === "gh");

    // Whatever this host has, the two fields answer different questions.
    expect(gh?.applicable).toBe(false);
    expect(typeof gh?.present).toBe("boolean");
  });
});

/** The recipe as rendered for a given `gh` state. */
function onboardWith(gh: Partial<HostTool>): string {
  return (
    getRecipe("onboard", {
      hostTools: [
        { name: "gh", present: true, applicable: true, ...gh },
        { name: "git", present: true, applicable: true },
        { name: "jq", present: false, applicable: true },
      ],
    }) ?? ""
  );
}

describe("onboard recipe renders host-tool state", () => {
  it("offers PR review comments and says the tool was not run", () => {
    const rendered = onboardWith({ present: true, applicable: true });

    expect(rendered).toContain("**Recent PR review comments**: `gh` is on");
    expect(rendered).toContain("did not run it");
    // The claim the recipe must never make about a file it only looked for.
    expect(rendered).not.toContain("`gh` is available");
  });

  it("omits PR review comments with a reason when gh is not on PATH", () => {
    const rendered = onboardWith({ present: false, applicable: true });

    expect(rendered).toContain("**Recent PR review comments** are not on this");
    expect(rendered).toContain("not on your PATH");
    expect(rendered).not.toContain("30 days of merged PRs");
  });

  it("gives the unfixable reason first for a repository with no GitHub origin", () => {
    // Present AND inapplicable: the case the precedence rule exists for.
    const rendered = onboardWith({ present: true, applicable: false });

    expect(rendered).toContain("repository has no GitHub origin");
    expect(rendered).toContain("Installing the GitHub CLI does not change");
    // Telling this user to install `gh` is the failure mode, and it is worse
    // than silence because they can act on it and still get nowhere.
    expect(rendered).not.toContain("**Recent PR review comments**: `gh` is on");
    expect(rendered).not.toContain("`gh` is\n     not on your PATH");
  });

  it("never tells the agent to re-probe once detection has run", () => {
    const rendered = onboardWith({ present: true, applicable: true });

    expect(rendered).toContain("Taskless already looked");
    expect(rendered).not.toContain("command -v gh");
  });

  it("mentions no tool at all when detection found nothing", () => {
    const rendered =
      getRecipe("onboard", {
        hostTools: [
          { name: "gh", present: false, applicable: true },
          { name: "git", present: false, applicable: true },
          { name: "jq", present: false, applicable: true },
        ],
      }) ?? "";

    // The whole point of the absent rendering: no instruction anywhere that
    // depends on a tool this host does not have.
    expect(rendered).not.toContain("Probe with `command -v gh`");
    expect(rendered).toContain("`gh`: not on your PATH");
  });
});

describe("the prompts export renders the full menu with no options", () => {
  it("offers every source and claims nothing about the host", () => {
    const rendered = getRecipe("onboard") ?? "";

    expect(rendered).toContain("**Codebase TODOs / FIXMEs**");
    expect(rendered).toContain("**Agent-memory files**");
    expect(rendered).toContain("**Recent PR review comments**");
    expect(rendered).toContain("**Bug-tracker tickets**");
    // Nothing was measured, so nothing may be asserted either way.
    expect(rendered).not.toContain("on your PATH");
    expect(rendered).not.toContain("are not on this menu");
    // And the probe instruction the CLI has not displaced here is still the
    // right one, because no answer has been supplied.
    expect(rendered).toContain("Confirm a tool exists before promising a scan");
  });

  it("names no single bug tracker as the expected one", () => {
    const rendered = getRecipe("onboard") ?? "";
    const tracker = rendered.slice(rendered.indexOf("**Bug-tracker tickets**"));

    expect(tracker).toContain("examples of the class");
    expect(rendered).not.toContain("(Linear, Jira, GitHub issues via");
  });
});
