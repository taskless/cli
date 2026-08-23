import { buildInvocation } from "./invocation";

/**
 * How the CLI answers "what would the reader type to run me again?"
 *
 * The answer has two halves that come from different places. The **package
 * specifier** (`@taskless/cli@latest`, `@taskless/cli-nightly@0.11.0-…`) is a
 * build-time fact, baked in by `scripts/build-target.ts`. The **launcher**
 * (`npx`, `pnpm dlx`) is a runtime fact, and the only honest source for it is
 * the path this process was launched from.
 *
 * IT IS NOT THE USER AGENT. `npm_config_user_agent` reports which package
 * manager is in the process tree, not which command anyone typed: `pnpm run`,
 * `pnpm exec`, `pnpm dlx`, and every pnpm lifecycle script all set `pnpm/…`.
 * Reading it alone is what made the CLI tell a developer running a
 * `package.json` script to `pnpm dlx @taskless/cli@latest auth login` — a
 * command that reinstalls the CLI they already have pinned. What actually
 * distinguishes the cases is where the binary lives:
 *
 * | Launcher      | `argv[1]` lives under                       |
 * | ------------- | ------------------------------------------- |
 * | `npx`         | the npm cache, `…/.npm/_npx/<hash>/…`       |
 * | `pnpm dlx`    | pnpm's dlx cache, `…/pnpm/dlx/<hash>/…`     |
 * | `pnpm run`    | the repository's own `node_modules/.bin`    |
 * | bare `node`   | wherever the file happens to be             |
 *
 * The last two are indistinguishable from each other, from a global install,
 * and from a `yarn`/`bun` launch. That is why detection is allowed to answer
 * "unknown" rather than falling back to a guess.
 */

/** A launcher this module is prepared to claim it recognized. */
export type Launcher = "npx" | "pnpm-dlx";

/**
 * Everything detection is allowed to look at. Injected rather than read, so
 * every launcher case is a table row instead of a spawned process — the same
 * reason `resolveBuildTarget` takes a `BuildEnvironment`.
 */
export interface LauncherContext {
  env: Record<string, string | undefined>;
  argv: readonly string[];
}

/** This process's own context. The one place `process` is read. */
export function processLauncherContext(): LauncherContext {
  return { env: process.env, argv: process.argv };
}

/** Path segments of `argv[1]`, split on either separator so Windows works. */
function launchPathSegments(context: LauncherContext): string[] {
  return (context.argv[1] ?? "").split(/[/\\]/);
}

/**
 * The directory pnpm keeps its dlx cache under, which is the store directory
 * rather than a fixed name: `…/pnpm/dlx/<hash>/…` on macOS and Linux,
 * `…\pnpm-cache\dlx\<hash>\…` on Windows. Matching `pnpm` with an optional
 * suffix covers both without accepting an unrelated parent directory.
 */
const PNPM_STORE_SEGMENT = /^pnpm(?:[-_][\w.-]+)?$/;

/**
 * Whether `argv[1]` runs out of pnpm's dlx cache, as opposed to merely passing
 * through some directory a person named `dlx`.
 *
 * The cache shape is `<pnpm store>/dlx/<hash>/…`, so a real hit has a pnpm
 * store segment immediately before `dlx` and at least one segment after it.
 * Requiring only a bare `dlx` segment would misread an ordinary `pnpm run` in
 * any repository that happens to contain a directory of that name — a milder
 * recurrence of the user-agent bug this module exists to fix.
 */
function inPnpmDlxCache(segments: readonly string[]): boolean {
  return segments.some(
    (segment, index) =>
      segment === "dlx" &&
      index > 0 &&
      PNPM_STORE_SEGMENT.test(segments[index - 1] ?? "") &&
      index + 1 < segments.length
  );
}

/**
 * Which launcher started this process, or `undefined` when nothing says.
 *
 * `undefined` is a real answer, not a failure. Every caller has a better
 * fallback of its own than a launcher this function would have to invent: the
 * recipe renderer emits an agent-fill marker, and the error messages print
 * `npx`, which at least resolves for everyone.
 */
export function detectLauncher(context: LauncherContext): Launcher | undefined {
  const segments = launchPathSegments(context);

  // npx: the cache directory is the strong signal; the env pair is what npx
  // sets for the script it runs, and covers a launch whose path was resolved
  // through a symlink.
  if (segments.includes("_npx")) return "npx";
  if (
    context.env.npm_command === "exec" &&
    context.env.npm_lifecycle_event === "npx"
  ) {
    return "npx";
  }

  // pnpm dlx: BOTH signals are required. The user agent alone is set by every
  // pnpm entry point, and a bare `dlx` path segment alone could be any
  // directory someone happened to name that — hence the full cache shape.
  const userAgent = context.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/") && inPnpmDlxCache(segments)) {
    return "pnpm-dlx";
  }

  return undefined;
}

/** The command word for a launcher, as a reader would type it. */
const LAUNCHER_COMMANDS: Record<Launcher, string> = {
  npx: "npx",
  "pnpm-dlx": "pnpm dlx",
};

/** The prefix a launcher-form build invocation carries. */
const NPX_PREFIX = "npx ";

/**
 * The package specifier this build should be reached by, pinned to a version,
 * or `undefined` when the build's invocation is a filesystem path.
 *
 * A `dev`/`self` build names `node <path>`; no launcher applies to it and
 * there is nothing to pin. A nightly's specifier already carries its exact
 * version — deliberately, since a floating `@taskless/cli-nightly` resolves to
 * whatever nightly is newest rather than the one whose instructions are being
 * read. Only the released `@taskless/cli` needs `@latest` appended, because
 * `npx` and `pnpm dlx` otherwise prefer whatever is already in the cache.
 */
function pinnedSpecifier(): string | undefined {
  const invocation = buildInvocation();
  if (!invocation.startsWith(NPX_PREFIX)) return undefined;
  const specifier = invocation.slice(NPX_PREFIX.length);
  // Scoped names open with `@`, so a version pin is an `@` anywhere after it.
  return specifier.includes("@", 1) ? specifier : `${specifier}@latest`;
}

/**
 * The full invocation for this process — launcher and pinned package — or
 * `undefined` when the launcher could not be determined.
 *
 * This is what the `agent` command hands to the recipe renderer. Returning
 * `undefined` rather than a default is the point: the renderer's marker asks
 * the reading agent to supply the launcher it actually has, which beats naming
 * one it may not.
 */
export function detectCliInvocation(
  context: LauncherContext
): string | undefined {
  const specifier = pinnedSpecifier();
  // A path-form build is authoritative and complete on its own.
  if (specifier === undefined) return buildInvocation();
  const launcher = detectLauncher(context);
  if (launcher === undefined) return undefined;
  return `${LAUNCHER_COMMANDS[launcher]} ${specifier}`;
}

/**
 * The invocation to print in a message a human reads — an authentication
 * prompt, an error remedy.
 *
 * Unlike {@link detectCliInvocation} this never returns `undefined`: a person
 * staring at an error needs something runnable, and `npx` resolves on every
 * machine. That display default is why the two functions are separate; a
 * marker would be useless here and a guessed launcher is useless in a recipe.
 */
export function getCliPrefix(): string {
  const detected = detectCliInvocation(processLauncherContext());
  if (detected !== undefined) return detected;
  const specifier = pinnedSpecifier();
  return specifier === undefined
    ? buildInvocation()
    : `${LAUNCHER_COMMANDS.npx} ${specifier}`;
}
