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

  const candidates: Array<[label: string, path: string | undefined]> = [
    ...spec.binaryNames.map((name): [string, string | undefined] => [
      platformPackageName(spec),
      platformPackageBinary(spec, executableName(name)),
    ]),
    ...spec.binaryNames.map((name): [string, string | undefined] => [
      "node_modules/.bin",
      resolve(localBin, executableName(name)),
    ]),
    ...spec.binaryNames.map((name): [string, string | undefined] => [
      "PATH",
      findOnPath(executableName(name)),
    ]),
  ];

  for (const [, path] of candidates) {
    if (path !== undefined && isPlatformBinary(spec, path)) {
      return { path, tried: candidates.map(([label]) => label) };
    }
  }

  return { path: undefined, tried: candidates.map(([label]) => label) };
}
