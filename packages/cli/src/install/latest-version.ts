/**
 * The newest published version of a package, from the npm registry alone.
 *
 * One host, on purpose: npm is already the party trusted for the install
 * itself, so asking it adds nobody new to the path. A CDN mirror was measured
 * faster when warm and rejected, since it would put a second party in front
 * of a string that ends up in a command the user runs.
 */

/** How long a lookup may take before it is abandoned as "unknown". */
export const LATEST_VERSION_TIMEOUT_MS = 1000;

/**
 * Strict semantic version, as semver.org publishes it: `MAJOR.MINOR.PATCH`,
 * an optional `-prerelease`, an optional `+build`, and nothing else.
 *
 * The answer is spliced into a command a user is told to run, so anything
 * looser (a leading `v`, a range, trailing whitespace, a shell operator) is
 * refused rather than repaired.
 */
const STRICT_SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function isStrictSemver(value: string): boolean {
  return STRICT_SEMVER.test(value);
}

/**
 * The `latest` dist-tag of `packageName`, or `undefined` when the registry
 * cannot say within the timeout, answers with anything but a 2xx, or names
 * something that is not a strict semantic version. Never throws: an unknown
 * answer is an ordinary outcome for an advisory check.
 */
export async function fetchLatestVersion(
  packageName: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<string | undefined> {
  const fetcher = options.fetch ?? fetch;
  try {
    const response = await fetcher(
      `https://registry.npmjs.org/-/package/${packageName}/dist-tags`,
      {
        signal: AbortSignal.timeout(
          options.timeoutMs ?? LATEST_VERSION_TIMEOUT_MS
        ),
        headers: { accept: "application/json" },
      }
    );
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const latest = (body as Record<string, unknown>).latest;
    return typeof latest === "string" && isStrictSemver(latest)
      ? latest
      : undefined;
  } catch {
    return undefined;
  }
}
