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
