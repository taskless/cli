import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NO_CI_PROVIDER,
  UNKNOWN_DIMENSION,
  isContinuousIntegration,
  resolveCiProvider,
  resolveLanguageStack,
  resolveRepositoryId,
  resolveWorkspaceId,
  resolveWorkspaceRoot,
} from "../src/util/adoption-dimensions";
import { canonicalRepositoryPath } from "../src/util/git-remote";

/**
 * Real git repositories rather than a mocked spawn.
 *
 * The behaviour under test IS git's answer — what `--show-toplevel` reports
 * from a subdirectory, and what a remote URL looks like once configured — so a
 * stub would only assert that the stub was written to match. The unresolvable
 * cases (git absent, spawn failure) are covered by the existing mocked suite
 * in `git-remote-context.test.ts`, which is the right shape for those.
 */
function makeRepository(remote?: string): string {
  const root = mkdtempSync(join(tmpdir(), "taskless-dimensions-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (remote) {
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  }
  return root;
}

describe("workspaceId identifies the workspace, not the directory", () => {
  it("reports the git top level from a subdirectory", async () => {
    const root = makeRepository();
    const nested = join(root, "packages", "cli");
    mkdirSync(nested, { recursive: true });

    // The equality IS the requirement. `check` from a package directory and
    // `check` from the repository root are one workspace, and anchoring on
    // cwd instead of the top level would make every subdirectory its own.
    expect(await resolveWorkspaceId(nested)).toBe(
      await resolveWorkspaceId(root)
    );
  });

  it("falls back to the working directory outside a git work tree", async () => {
    const plain = mkdtempSync(join(tmpdir(), "taskless-plain-"));
    expect(await resolveWorkspaceRoot(plain)).toBe(resolve(plain));
    expect(await resolveWorkspaceId(plain)).toMatch(/^[\da-f]{64}$/);
  });

  it("distinguishes two clones of one repository", async () => {
    const remote = "git@github.com:taskless/cli.git";
    const first = makeRepository(remote);
    const second = makeRepository(remote);

    // Different workspaces, same codebase. That split is the whole point of
    // carrying both properties.
    expect(await resolveWorkspaceId(first)).not.toBe(
      await resolveWorkspaceId(second)
    );
    expect(await resolveRepositoryId(first)).toBe(
      await resolveRepositoryId(second)
    );
  });
});

describe("repositoryId is host-agnostic", () => {
  it("resolves a non-GitHub remote", async () => {
    const root = makeRepository("git@gitlab.com:acme/widgets.git");

    // The case a GitHub-shaped implementation silently gets wrong: a GitLab
    // repository is a codebase like any other and must be counted.
    expect(await resolveRepositoryId(root)).toMatch(/^[\da-f]{64}$/);
    expect(await resolveRepositoryId(root)).not.toBe(UNKNOWN_DIMENSION);
  });

  it("reports the sentinel with no origin remote", async () => {
    const root = makeRepository();
    expect(await resolveRepositoryId(root)).toBe(UNKNOWN_DIMENSION);
  });

  it("reports the sentinel outside a repository", async () => {
    const plain = mkdtempSync(join(tmpdir(), "taskless-plain-"));
    expect(await resolveRepositoryId(plain)).toBe(UNKNOWN_DIMENSION);
  });
});

describe("canonicalRepositoryPath", () => {
  it("reduces every remote form to one identity", () => {
    const expected = "github.com/taskless/cli";
    for (const remote of [
      "git@github.com:taskless/cli.git",
      "git@github.com:taskless/cli",
      "https://github.com/taskless/cli.git",
      "https://github.com/taskless/cli",
      "ssh://git@github.com/taskless/cli.git",
      "git://github.com/taskless/cli.git",
      "https://user:token@github.com:443/taskless/cli.git?ref=main#top",
      "//github.com/taskless/cli",
    ]) {
      expect(canonicalRepositoryPath(remote), remote).toBe(expected);
    }
  });

  it("lowercases, because GitHub treats the path case-insensitively", () => {
    expect(canonicalRepositoryPath("https://GitHub.com/Taskless/CLI")).toBe(
      "github.com/taskless/cli"
    );
  });

  it("keeps non-GitHub hosts distinct", () => {
    expect(canonicalRepositoryPath("git@gitlab.com:acme/widgets.git")).toBe(
      "gitlab.com/acme/widgets"
    );
    expect(canonicalRepositoryPath("https://git.internal/acme/widgets")).toBe(
      "git.internal/acme/widgets"
    );
  });

  it("keeps the whole nested group path", () => {
    expect(
      canonicalRepositoryPath("git@gitlab.com:acme/team/sub/widgets.git")
    ).toBe("gitlab.com/acme/team/sub/widgets");
  });

  it("does not collapse two repositories that share an owner and a leaf name", () => {
    // The reason the whole path is kept (taskless/cli#326 review). Dropping
    // the middle segments merged these two into one identity, silently
    // undercounting distinct codebases in exactly the nested-group case this
    // parser exists to serve.
    expect(
      canonicalRepositoryPath("git@gitlab.com:acme/team1/api.git")
    ).not.toBe(canonicalRepositoryPath("git@gitlab.com:acme/team2/api.git"));
  });

  it("returns null when there is no owner/repo pair", () => {
    expect(canonicalRepositoryPath("")).toBeNull();
    expect(canonicalRepositoryPath("taskless")).toBeNull();
    expect(canonicalRepositoryPath("https://github.com/taskless")).toBeNull();
  });
});

describe("the CI dimensions", () => {
  it("treats any non-negative value as CI", () => {
    for (const value of ["1", "true", "yes", "woodpecker"]) {
      expect(isContinuousIntegration({ CI: value }), value).toBe(true);
    }
  });

  it("treats unset, empty, 0 and false as not CI", () => {
    expect(isContinuousIntegration({})).toBe(false);
    for (const value of ["", "  ", "0", "false", "FALSE"]) {
      expect(isContinuousIntegration({ CI: value }), value).toBe(false);
    }
  });

  it("names a recognized provider", () => {
    expect(resolveCiProvider({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(
      "github_actions"
    );
    expect(resolveCiProvider({ CI: "true", BUILDKITE: "true" })).toBe(
      "buildkite"
    );
  });

  it("distinguishes an unrecognized provider from a local run", () => {
    // The two sentinels carry different meanings and must not collapse: one
    // is a gap in the provider table, the other is an ordinary laptop.
    expect(resolveCiProvider({ CI: "true" })).toBe(UNKNOWN_DIMENSION);
    expect(resolveCiProvider({})).toBe(NO_CI_PROVIDER);
  });

  it("prefers the specific marker over the generic one", () => {
    // Providers nest — GitHub Actions sets CI as well — so ordering decides.
    expect(
      resolveCiProvider({
        CI: "true",
        GITHUB_ACTIONS: "true",
        JENKINS_URL: "x",
      })
    ).toBe("github_actions");
  });
});

describe("languageStack", () => {
  it("reports the languages its root manifests evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "taskless-stack-"));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "go.mod"), "module example\n");

    const stack = resolveLanguageStack(root);
    expect(stack).toContain("JavaScript/TypeScript");
    expect(stack).toContain("Go");
  });

  it("reports an empty array rather than nothing when no manifest is present", () => {
    const root = mkdtempSync(join(tmpdir(), "taskless-empty-"));
    expect(resolveLanguageStack(root)).toEqual([]);
  });

  it("does not see a language confined to a sub-package", () => {
    // Documented and accepted: the probe is root-only so it can run on every
    // invocation. Pinned so nobody "fixes" it into a recursive walk.
    const root = mkdtempSync(join(tmpdir(), "taskless-mono-"));
    writeFileSync(join(root, "package.json"), "{}");
    mkdirSync(join(root, "services", "api"), { recursive: true });
    writeFileSync(join(root, "services", "api", "pyproject.toml"), "");

    expect(resolveLanguageStack(root)).not.toContain("Python");
  });
});
