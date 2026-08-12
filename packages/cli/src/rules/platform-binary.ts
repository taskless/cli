import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolving a prebuilt binary that ships as a per-platform npm package.
 *
 * This was ast-grep's resolver in `scan.ts`, generalized when Vale became a
 * second engine that needs the same treatment. Both depend on per-platform
 * packages directly and exec by path, because neither can rely on an
 * install-time step: `@ast-grep/cli`'s postinstall hardlink fails under pnpm
 * dlx's strict isolation, and the `@taskless/vale-*` packages deliberately ship
 * no `bin` and no scripts at all.
 *
 * WHAT IS PARAMETERIZED, and why each field exists rather than being derived:
 *
 * - `toolchainSuffix` is the one that bites. ast-grep publishes
 *   `@ast-grep/cli-linux-x64-gnu` and `-win32-x64-msvc`; the Vale packages are
 *   `@taskless/vale-linux-x64` with **no libc suffix at all**. Reusing
 *   ast-grep's naming for Vale would look up `@taskless/vale-linux-x64-gnu` and
 *   miss on every Linux host — a resolution failure that reads as "Vale is not
 *   installed" rather than as a naming bug.
 * - `identity` exists because existence is not proof. A file can sit exactly
 *   where the binary belongs and not be the binary: ast-grep's failed hardlink
 *   leaves a placeholder text file there. Asking a candidate to identify itself
 *   is the only check that tells the two apart.
 */
export interface PlatformBinarySpec {
  /** Name used in error messages, e.g. `ast-grep`. */
  label: string;
  /** Package name up to the platform suffix, e.g. `@ast-grep/cli`. */
  packagePrefix: string;
  /**
   * Append the platform's toolchain suffix (`-gnu` on Linux, `-msvc` on
   * Windows). True for ast-grep, false for the Vale packages.
   */
  toolchainSuffix: boolean;
  /**
   * Executable names to try, in confidence order, spelled for unix. `.exe` is
   * appended on Windows. More than one because ast-grep declares both
   * `ast-grep` and `sg` for the same target.
   *
   * The first name is the canonical one: it is the only spelling probed inside
   * the platform package, and it is the name error messages tell the user to put
   * on PATH. The rest are alternative link names, tried *first* at the
   * link-based tiers — see {@link resolvePlatformBinary}.
   */
  binaryNames: string[];
  /** Pattern the candidate's own `--version` output must match. */
  identity: RegExp;
}

/** The npm package carrying this host's prebuilt binary. */
export function platformPackageName(spec: PlatformBinarySpec): string {
  const parts: string[] = [process.platform, process.arch];
  if (spec.toolchainSuffix) {
    if (process.platform === "linux") {
      parts.push("gnu");
    } else if (process.platform === "win32") {
      parts.push("msvc");
    }
  }
  return `${spec.packagePrefix}-${parts.join("-")}`;
}

/** Executable name for this platform. */
function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/**
 * The spellings tried at the link-based tiers (`node_modules/.bin`, `PATH`), in
 * order — the reverse of {@link PlatformBinarySpec.binaryNames}.
 *
 * Reversed deliberately, preserving ast-grep's original resolver: it tried `sg`
 * before `ast-grep` at both tiers. Nothing observable hangs on it today, since
 * both names link to the same target and {@link isPlatformBinary} verifies
 * whichever one answers, so this is about keeping a documented ordering rather
 * than repairing a behavioural bug. It is kept because the ordering is the only
 * record of which spelling we expect to find, and the same list decides which
 * name a failure message tells the user to put on PATH.
 */
function linkNames(spec: PlatformBinarySpec): string[] {
  return spec.binaryNames.toReversed();
}

/**
 * The command name to tell a user to put on PATH, spelled for this platform
 * (`sg.exe` on Windows). It is the first spelling the PATH search itself tries,
 * so the advice and the search cannot drift apart.
 */
export function pathCommandName(spec: PlatformBinarySpec): string {
  return executableName(linkNames(spec)[0] ?? spec.label);
}

/** Absolute path to a binary inside the resolved platform package, if any. */
function platformPackageBinary(
  spec: PlatformBinarySpec,
  binary: string
): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(
      `${platformPackageName(spec)}/package.json`
    );
    return resolve(dirname(packageJsonPath), binary);
  } catch {
    // Not installed for this host: an unsupported arch, or musl, where neither
    // project publishes a build and `os`/`cpu` filtering skips the package.
    return undefined;
  }
}

/** First entry on PATH that holds a file named `command`. */
export function findOnPath(command: string): string | undefined {
  const separator = process.platform === "win32" ? ";" : ":";
  for (const directory of (process.env.PATH ?? "").split(separator)) {
    if (directory === "") continue;
    const candidate = resolve(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Whether `path` is really this binary, established by running it.
 *
 * See {@link PlatformBinarySpec.identity} — existence is not enough, because a
 * placeholder file left by a failed install sits at exactly the right path and
 * satisfies `existsSync` happily.
 */
export function isPlatformBinary(
  spec: PlatformBinarySpec,
  path: string
): boolean {
  if (!existsSync(path)) return false;
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error !== undefined || result.status !== 0) return false;
  return spec.identity.test(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

/** One place to look, paired with the label `tried` reports it under. */
type Candidate = [label: string, path: string | undefined];

export interface PlatformBinaryResolution {
  /** Absolute path to the verified binary, or `undefined` when none resolved. */
  path: string | undefined;
  /** Locations searched, in order, for an actionable failure message. */
  tried: string[];
}

/**
 * Search every place the binary could reasonably live, verifying each.
 *
 * Candidates are ordered by confidence rather than by convenience — the
 * platform package first because it is the version we pinned, then a locally
 * linked binary, then whatever the host provides on PATH.
 *
 * The platform package is probed under one name only. Its contents are ours to
 * predict — the package ships the binary under its canonical name — so trying
 * the alternative spellings there buys nothing but an extra `require.resolve`
 * and a duplicate entry in `tried`, which reads to the user as the same
 * location searched twice. The link-based tiers do try every spelling, because
 * which one exists there is the installer's choice, not ours.
 *
 * Returns rather than throws. The two callers want different things from a
 * miss: ast-grep cannot run at all without it, while a missing Vale binary
 * makes one engine unavailable and must not abort the others (D6b). Encoding
 * "not found" as a value rather than an exception is what lets each decide.
 */
export function resolvePlatformBinary(
  spec: PlatformBinarySpec
): PlatformBinaryResolution {
  const localBin = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".bin"
  );

  const links = linkNames(spec);
  const candidates: Candidate[] = [
    [
      platformPackageName(spec),
      platformPackageBinary(
        spec,
        executableName(spec.binaryNames[0] ?? spec.label)
      ),
    ],
    ...links.map(
      (name): Candidate => [
        "node_modules/.bin",
        resolve(localBin, executableName(name)),
      ]
    ),
    ...links.map(
      (name): Candidate => ["PATH", findOnPath(executableName(name))]
    ),
  ];

  // `tried` names *locations*, not candidates: a tier searched under two
  // spellings is still one place the user can look, and repeating its label
  // makes "Looked in: …" read as if we searched it twice.
  const tried = [...new Set(candidates.map(([label]) => label))];

  for (const [, path] of candidates) {
    if (path !== undefined && isPlatformBinary(spec, path)) {
      return { path, tried };
    }
  }

  return { path: undefined, tried };
}
