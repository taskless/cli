import type { HostTool } from "../prompts/recipes";
import { executableName, findOnPath } from "../rules/platform-binary";
import {
  UNKNOWN_GH_OWNER,
  isGitLabOrigin,
  resolveRepositoryContext,
} from "../util/git-remote";
import { HOST_TOOL_CATALOG } from "./host-tool-catalog";

// `HostTool` is declared in `prompts/recipes.ts` rather than here because the
// render contract is what the shape exists to satisfy, and that module is
// published as `@taskless/cli/prompts`. A type-only import is erased at build
// time, so this file's node builtins never enter the prompts chunk graph — the
// constraint `assert-library-graphs` enforces in `vite.config.ts`.

/**
 * What the host has, for the recipes that condition on it.
 *
 * ESTABLISHED BY LOOKING, NOT BY RUNNING. {@link findOnPath} walks `PATH` and
 * asks the filesystem whether a file of that name exists; it executes nothing.
 * That is the whole property being bought. A detection pass that spawns
 * arbitrary binaries found on a user's `PATH` is a far larger promise than any
 * recipe here needs, and it is not one this CLI makes. Whether a tool is
 * signed in is the agent's question to ask, through {@link detectAgentHints}.
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
 * {@link UNKNOWN_GH_OWNER} sentinel. `glab` asks {@link isGitLabOrigin}, which
 * never throws either.
 */
export async function detectHostTools(cwd: string): Promise<HostTool[]> {
  const [{ ghOwner }, onGitLab] = await Promise.all([
    resolveRepositoryContext(cwd),
    isGitLabOrigin(cwd),
  ]);
  const forgeMatches = {
    github: ghOwner !== UNKNOWN_GH_OWNER,
    gitlab: onGitLab,
  };

  return HOST_TOOL_CATALOG.map((entry) => {
    // `executableName` first, ALWAYS. `findOnPath` matches a `PATH` entry
    // joined with the literal string and consults no `PATHEXT`, so a bare
    // `"gh"` finds nothing on Windows, where the file is `gh.exe`. The failure
    // is silent and lands as `present: false` for a tool the user has
    // installed — which the recipe then renders as "install the GitHub CLI",
    // the one instruction that cannot help them. CI runs `ubuntu-latest`
    // only, so nothing else catches it.
    const path = findOnPath(executableName(entry.name));
    // A tool tied to a forge is useful only on that forge; the rest are
    // applicable wherever they are installed.
    const applicable =
      entry.forge === undefined ? true : forgeMatches[entry.forge];
    return {
      name: entry.name,
      present: path !== undefined,
      ...(path === undefined ? {} : { path }),
      applicable,
      // The reason travels WITH the verdict, because the renderer must not
      // infer one. It is the detector that knows why a tool is inapplicable,
      // and the phrasing is a fragment so a consumer can set it in
      // parentheses or in a sentence of its own.
      ...(!applicable && entry.inapplicableReason !== undefined
        ? { reason: entry.inapplicableReason }
        : {}),
    };
  });
}

/**
 * Commands the agent may choose to run, keyed by command, for each tool that
 * is present and applicable.
 *
 * A tool that is missing or useless here gets no hint: a command the agent
 * cannot run, or one whose answer cannot matter, is a turn spent for nothing.
 */
export function detectAgentHints(tools: HostTool[]): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const tool of tools) {
    if (!tool.present || !tool.applicable) continue;
    const hint = HOST_TOOL_CATALOG.find(
      (entry) => entry.name === tool.name
    )?.hint;
    if (hint !== undefined) hints[hint.command] = hint.meaning;
  }
  return hints;
}
