import {
  pathCommandName,
  resolvePlatformBinary,
  type PlatformBinaryResolution,
  type PlatformBinarySpec,
} from "../platform-binary";

/**
 * Vale's per-platform packaging.
 *
 * `toolchainSuffix: false` is the whole reason this spec exists separately from
 * ast-grep's. `add-vale-binary-packages` publishes `@taskless/vale-<os>-<cpu>`
 * — `@taskless/vale-linux-x64`, not `-linux-x64-gnu`. ast-grep's resolver
 * appends `-gnu` on every Linux, so reusing its naming here would resolve
 * nothing on Linux while reporting the ordinary "Vale is unavailable" message,
 * making a naming bug indistinguishable from a host without the binary.
 *
 * One binary name, unlike ast-grep's two: these packages ship `vale` (or
 * `vale.exe`) as pure payload, with no `bin` entry and no lifecycle script, so
 * there is no wrapper spelling to also try.
 */
export const VALE_BINARY: PlatformBinarySpec = {
  label: "vale",
  packagePrefix: "@taskless/vale",
  toolchainSuffix: false,
  binaryNames: ["vale"],
  identity: /vale/i,
};

/**
 * Resolution is cached for the process, including a miss.
 *
 * Caching the miss matters as much as caching the hit: resolution spawns a
 * subprocess per candidate, and an absent Vale is the common case on a host
 * that never installed it. Without this, every rule would re-run the whole
 * search to rediscover the same nothing.
 */
let cached: PlatformBinaryResolution | undefined;

/**
 * Locate the Vale binary, or report that it is unavailable.
 *
 * Returns `undefined` rather than throwing, per D6b: a missing Vale binary
 * makes the Vale engine unavailable and must not abort the other engines. The
 * caller turns that into a reported-but-not-fatal outcome; ast-grep's resolver
 * throws instead, because it has no degraded mode.
 */
export function findValeBinary(): PlatformBinaryResolution {
  cached ??= resolvePlatformBinary(VALE_BINARY);
  return cached;
}

/** Reset the process cache. Tests only. */
export function resetValeBinaryCache(): void {
  cached = undefined;
}

/**
 * An actionable message naming where we looked.
 *
 * The PATH advice is spelled for the platform — `vale.exe` on Windows — rather
 * than hardcoded, so a Windows user is not told to install a name that the
 * resolver would not find there.
 */
export function valeUnavailableMessage(tried: string[]): string {
  return (
    `Vale binary not found. Looked in: ${tried.join(", ")}. Install a ` +
    `supported platform build, or put \`${pathCommandName(VALE_BINARY)}\` on ` +
    `your PATH. Other engines still ran.`
  );
}
