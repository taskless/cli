/**
 * Compare two dotted version strings numerically, ignoring any prerelease
 * suffix.
 *
 * A nightly is `0.11.0-20260826062304x3c78ffe`, so a plain string comparison
 * would sort it after `0.11.0` and let a nightly-built project refuse a
 * release-built one. Only the numeric core is compared, which makes a nightly
 * and its release equal for this purpose. That is the right answer: they carry
 * the same ledger entries.
 */
function versionCore(version: string): number[] {
  return (version.split("-")[0] ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = versionCore(a);
  const right = versionCore(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Compare two versions with semver precedence, prerelease included.
 *
 * `compareVersions` is right for the reconciliation ledger and wrong for
 * asking "is this build older than that one". A nightly is stamped with the
 * release it ANTICIPATES (`0.12.0-20261002181147x023048f` while 0.11.2 is the
 * latest), so it sorts before that release, and two nightlies of one base can
 * sit weeks and several migrations apart. Semver precedence answers both: a
 * prerelease sorts before its release, and two prereleases compare identifier
 * by identifier, which orders nightlies by build time because the timestamp
 * leads the stamp. Build metadata (`+…`) carries no precedence.
 */
export function compareSemver(a: string, b: string): number {
  const core = compareVersions(a, b);
  if (core !== 0) return core;
  const left = prerelease(a);
  const right = prerelease(b);
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return comparePrerelease(left, right);
}

/**
 * Semver's prerelease precedence: dot-separated identifiers compared left to
 * right, a numeric identifier by value and below any alphanumeric one, and a
 * shorter list below a longer one it is a prefix of. A plain string
 * comparison agrees for a nightly stamp, whose leading timestamp is
 * fixed-width, and disagrees for `rc.9` against `rc.10`, which it orders
 * backwards.
 */
function comparePrerelease(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const delta = compareIdentifier(left[index] ?? "", right[index] ?? "");
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

const NUMERIC_IDENTIFIER = /^\d+$/;

function compareIdentifier(a: string, b: string): number {
  const aNumeric = NUMERIC_IDENTIFIER.test(a);
  const bNumeric = NUMERIC_IDENTIFIER.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function prerelease(version: string): string | undefined {
  const withoutBuild = version.split("+")[0] ?? "";
  const dash = withoutBuild.indexOf("-");
  return dash === -1 ? undefined : withoutBuild.slice(dash + 1);
}
