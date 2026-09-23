import type { HostTool } from "../prompts/recipes";
import { executableName, findOnPath } from "../rules/platform-binary";
import { UNKNOWN_GH_OWNER, resolveRepositoryContext } from "../util/git-remote";

// `HostTool` is declared in `prompts/recipes.ts` rather than here because the
// render contract is what the shape exists to satisfy, and that module is
// published as `@taskless/cli/prompts`. A type-only import is erased at build
// time, so this file's node builtins never enter the prompts chunk graph — the
// constraint `assert-library-graphs` enforces in `vite.config.ts`.

/**
 * The tools detected, in a fixed order.
 *
 * Fixed rather than derived from what was found, so a rendering that lists
 * them is stable across hosts and two runs on the same host cannot differ by
 * ordering alone.
 */
const DETECTED_TOOLS = ["gh", "git", "jq"] as const;

/**
 * Why `gh` is inapplicable when the repository has no GitHub `origin`.
 *
 * States the property of the PROJECT, not of the install, because that is the
 * part no action by the user changes. An agent that reads this should stop
 * offering the source rather than suggest installing anything.
 */
const NO_GITHUB_ORIGIN = "this repository has no GitHub origin";

/**
 * What the host has, for the recipes that condition on it.
 *
 * ESTABLISHED BY LOOKING, NOT BY RUNNING. {@link findOnPath} walks `PATH` and
 * asks the filesystem whether a file of that name exists; it executes nothing.
 * That is the whole property being bought. A detection pass that spawns
 * arbitrary binaries found on a user's `PATH` is a far larger promise than any
 * recipe here needs, and it is not one this CLI makes.
 *
 * A verification tier was considered and rejected on measurement rather than
 * on principle: GitHub publishes sha256 digests for `gh`'s release archives
 * and installers, not for the extracted binary, and a Homebrew-installed `gh`
 * 2.97.0 matched 0 of the 21 official digests. A tier that reports
 * "unverified" for the ordinary macOS install path is worse than no tier,
 * because a reader takes that word to mean "suspicious" rather than "not
 * checkable".
 *
 * `applicable` for `gh` comes from {@link resolveRepositoryContext}, the same
 * resolution behind `info` and telemetry, rather than from a second
 * "is this GitHub" probe that could disagree with it. That call never throws:
 * a directory that is not a repository, a repository with no `origin`, a
 * non-GitHub `origin` and a host with no `git` all resolve to the
 * {@link UNKNOWN_GH_OWNER} sentinel.
 */
export async function detectHostTools(cwd: string): Promise<HostTool[]> {
  const { ghOwner } = await resolveRepositoryContext(cwd);
  const onGitHub = ghOwner !== UNKNOWN_GH_OWNER;

  return DETECTED_TOOLS.map((name) => {
    // `executableName` first, ALWAYS. `findOnPath` matches a `PATH` entry
    // joined with the literal string and consults no `PATHEXT`, so a bare
    // `"gh"` finds nothing on Windows, where the file is `gh.exe`. The failure
    // is silent and lands as `present: false` for a tool the user has
    // installed — which the recipe then renders as "install the GitHub CLI",
    // the one instruction that cannot help them. CI runs `ubuntu-latest`
    // only, so nothing else catches it.
    const path = findOnPath(executableName(name));
    return {
      name,
      present: path !== undefined,
      ...(path === undefined ? {} : { path }),
      // `gh` is the only tool whose usefulness depends on the repository.
      // `git` and `jq` are applicable wherever they are installed.
      applicable: name === "gh" ? onGitHub : true,
      // The reason travels WITH the verdict, because the renderer must not
      // infer one. It is the detector that knows why `gh` is inapplicable, and
      // the phrasing is a fragment so a consumer can set it in parentheses or
      // in a sentence of its own.
      ...(name === "gh" && !onGitHub ? { reason: NO_GITHUB_ORIGIN } : {}),
    };
  });
}
