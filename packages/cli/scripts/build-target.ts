/**
 * How a build target decides what CLI invocation is baked into the skill,
 * command, and recipe content it emits.
 *
 * This lives beside `vite.config.ts` rather than inside it so the resolution is
 * unit-testable: every function here is pure over an explicit environment,
 * which is the only way to assert that a `nightly` build with no version fails
 * instead of silently emitting the released invocation.
 */

/** The npm package a nightly is published under (see `nightly-pack.cjs`). */
const NIGHTLY_PACKAGE = "@taskless/cli-nightly";

/**
 * The env var carrying the exact version a nightly build is being made for.
 *
 * It is REQUIRED for the `nightly` target and is never computed here. The
 * version is stamped once — by `nightly-pack.cjs --print-version` — and handed
 * to both the build and the pack, because a version computed twice is computed
 * from two different clocks: the build would advertise `…x<sha>` at one
 * timestamp while the published tarball carried another, and every instruction
 * in the nightly would name a version that does not exist on npm.
 */
export const NIGHTLY_VERSION_ENV = "TASKLESS_NIGHTLY_VERSION";

/**
 * The build target this repository used to have, removed and not coming back.
 *
 * `dev` emitted an absolute path so a local build could be exercised from
 * ANOTHER repository. That job belongs to the published nightly now: it
 * resolves on any machine and is pinned to the build whose instructions it
 * carries, where an absolute path is machine-specific and may not exist.
 *
 * Named here rather than deleted outright so a stale `TASKLESS_BUILD_TARGET=dev`
 * gets an answer. See `resolveBuildTarget`.
 */
const REMOVED_TARGET = "dev";

/**
 * Each build target emits to its own directory so prod and self builds never
 * overwrite one another. Keyed by TASKLESS_BUILD_TARGET; anything other than a
 * key here is treated as prod.
 *
 * `nightly` IS THE EXCEPTION: it emits to `dist`, the same directory as prod,
 * and a local `build:nightly` therefore OVERWRITES a prod build in place. That
 * is not an oversight — the nightly tarball is packed from `packages/cli` with
 * `files: ["dist"]` and `bin: ./dist/index.js`, so `dist` is the only directory
 * npm would carry. Run `pnpm --filter @taskless/cli build` afterwards to get an
 * ordinary `dist` back; `pnpm cli` runs whatever is there.
 */
export const OUT_DIRS = {
  prod: "dist",
  self: "dist-self",
  nightly: "dist",
} as const;

export type BuildTarget = keyof typeof OUT_DIRS;

/** The official semver 2.0.0 grammar, from semver.org. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A build environment: `process.env`, or a literal in a test. */
export type BuildEnvironment = Record<string, string | undefined>;

/**
 * The target this build is for, defaulting to prod.
 *
 * An unrecognized value falls back to prod, which is the right leniency for a
 * typo: prod is what a build with no opinion should be, and it is the only
 * target that needs no extra environment.
 *
 * `dev` is the one value that does NOT get that leniency. It was a real target
 * that emitted `dist-dev/`, so a caller who still sets it is not expressing no
 * opinion — they are waiting on an artifact that will never be written. Falling
 * back would build prod into `dist/` (overwriting a prod build) and report
 * nothing, and the caller would meet the removal as a missing
 * `dist-dev/index.js` at a path no remaining file mentions. An error here names
 * the cause once, at the moment it can still be acted on.
 */
export function resolveBuildTarget(environment: BuildEnvironment): BuildTarget {
  const target = environment.TASKLESS_BUILD_TARGET;
  if (target === REMOVED_TARGET) {
    throw new Error(
      `TASKLESS_BUILD_TARGET=${REMOVED_TARGET} names a build target that has been ` +
        `removed. It existed to run a local build from another repository; use ` +
        `a published ${NIGHTLY_PACKAGE} for that. To dogfood inside this ` +
        `repository, use "pnpm build:self".`
    );
  }
  return target === "self" || target === "nightly" ? target : "prod";
}

export function resolveOutputDirectory(environment: BuildEnvironment): string {
  return OUT_DIRS[resolveBuildTarget(environment)];
}

/**
 * The version a `nightly` build is stamped for, or a thrown error.
 *
 * THIS MUST NEVER FALL BACK. A nightly whose version is missing or malformed
 * has no correct invocation to emit, and the plausible-looking fallback —
 * `npx @taskless/cli` — is precisely the bug the nightly target exists to fix:
 * an agent sent to the released package after someone installed a nightly to
 * exercise unreleased behavior. A build error is loud; a wrong string is not.
 */
export function resolveNightlyVersion(environment: BuildEnvironment): string {
  const version = environment[NIGHTLY_VERSION_ENV];
  if (version === undefined || version.length === 0) {
    throw new Error(
      `TASKLESS_BUILD_TARGET=nightly requires ${NIGHTLY_VERSION_ENV}; ` +
        `compute it once with "node .github/scripts/nightly-pack.cjs --print-version …" ` +
        `and pass the same value to the build and the pack.`
    );
  }
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(
      `${NIGHTLY_VERSION_ENV} is not a valid semantic version: ${JSON.stringify(version)}`
    );
  }
  return version;
}

/**
 * The version this build should report as its own — `__VERSION__`, which backs
 * `taskless --version`, the `%(CLI_VERSION)s` recipe header, the `cliVersion`
 * telemetry property, and the `install.cliVersion` written into
 * `.taskless/taskless.json`.
 *
 * For every target but `nightly` this is the committed package version. A
 * nightly is the exception because its version is stamped at pack time and the
 * manifest in version control is deliberately left alone — so reading
 * `package.json` at build time yields the version of the release the nightly
 * ANTICIPATES, not the version it is published as.
 *
 * Getting this wrong is quiet rather than loud. A nightly installed to exercise
 * unreleased behavior records `install.cliVersion` as the last release, so the
 * manifest disagrees with the skills emitted beside it — which pin the exact
 * nightly — and anyone reading the manifest to answer "what installed this?"
 * gets a version that never wrote it.
 */
export function resolveCliVersion(
  environment: BuildEnvironment,
  packageVersion: string
): string {
  return resolveBuildTarget(environment) === "nightly"
    ? resolveNightlyVersion(environment)
    : packageVersion;
}

/**
 * Refuse to emit a nightly whose two version-bearing defines disagree.
 *
 * A post-mortem guard, not a hypothetical one. #148 shipped because
 * `__VERSION__` and `__TASKLESS_CLI__` are *derived* from the same stamp but
 * were not *checked* against each other: the invocation read
 * `TASKLESS_NIGHTLY_VERSION` and the version read `package.json`, so one
 * artifact simultaneously announced v0.10.2 and sent every agent to
 * v0.11.0-…. Nothing failed. The disagreement was only visible by comparing
 * two outputs of the same build against each other, which is exactly what
 * nobody does.
 *
 * They are coupled by construction today. This exists so that if a later
 * refactor decouples them — a second env var, a cached value, a default
 * reintroduced "for local builds" — the build stops instead of shipping the
 * same silent mismatch again. The check is cheap and it fires at the only
 * moment the two values are both in hand.
 *
 * Deliberately asks the resolved defines rather than scanning the emitted
 * bundle: the build already holds the structured values, and re-deriving them
 * from generated text would be the weaker tool (see the styleguide's
 * "verify build output in the build").
 */
export function assertVersionConsistency(
  environment: BuildEnvironment,
  version: string,
  invocation: string
): void {
  if (resolveBuildTarget(environment) !== "nightly") return;
  if (invocation.endsWith(`@${version}`)) return;
  throw new Error(
    `nightly build is inconsistent with itself: it reports version ` +
      `${JSON.stringify(version)} but its invocation is ` +
      `${JSON.stringify(invocation)}. These must name the same version — a ` +
      `build that announces one version and sends agents to another is ` +
      `taskless/cli#148. Both derive from ${NIGHTLY_VERSION_ENV}; if they no ` +
      `longer do, that is the bug.`
  );
}

/**
 * The CLI invocation baked into emitted skill/command/recipe content, chosen by
 * the TASKLESS_BUILD_TARGET env var (see package.json build:self/
 * build:nightly):
 *   - prod (default): the published `npx @taskless/cli`
 *   - self: a repo-root-relative path, for dogfooding inside this repo
 *   - nightly: `npx @taskless/cli-nightly@<version>`, PINNED to the exact
 *     version being published — a floating `@taskless/cli-nightly` would send
 *     an agent to whatever nightly is newest, which is not the build whose
 *     skills it is reading.
 *
 * `self` is the only target whose invocation is a path, and it is relative to
 * the repo root, so it only resolves for a CLI run from inside this checkout.
 * That is the whole local story: nothing here emits an invocation usable from
 * another repository, and a published nightly is what serves that case.
 */
export function resolveCliInvocation(environment: BuildEnvironment): string {
  switch (resolveBuildTarget(environment)) {
    case "self": {
      return `node packages/cli/${OUT_DIRS.self}/index.js`;
    }
    case "nightly": {
      return `npx ${NIGHTLY_PACKAGE}@${resolveNightlyVersion(environment)}`;
    }
    default: {
      return "npx @taskless/cli";
    }
  }
}

/**
 * A one-time banner prepended to canonical skill/command bodies for the `self`
 * build, so an agent that's told to call the local CLI knows how to produce it
 * if the build artifact is missing. Empty for prod (no banner is emitted).
 *
 * ALSO EMPTY FOR `nightly`, deliberately. The banner exists for one reason: the
 * `self` invocation names a filesystem path that may not exist yet, and the
 * agent needs to be told how to create it. A nightly's invocation is a
 * published, version-pinned package that `npx` resolves on any machine, so
 * there is no such failure to pre-empt — and the invocation itself already
 * reads `@taskless/cli-nightly@<version>`, which says everything a banner
 * would. Adding one would put a permanent build-provenance notice into the body
 * of every installed skill, where it is noise on every read.
 */
export function resolveCliNotice(environment: BuildEnvironment): string {
  if (resolveBuildTarget(environment) !== "self") return "";
  return (
    `> **Local Taskless build.** The commands below call a locally built CLI ` +
    `(\`${resolveCliInvocation(environment)}\`). If that ` +
    `path does not exist yet, run \`pnpm build:self\` from the repo root first.`
  );
}
