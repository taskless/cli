import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Add a compare link under each version heading in the CLI's CHANGELOG.
 *
 * Changesets writes `## <version>` and the notes beneath it, and nothing that
 * says which commits a release actually contained. Reviewing "what shipped in
 * 0.11.0" then means finding the version-bump commit by hand, which is harder
 * than it sounds because every one of them is called `chore: version packages`.
 *
 * Runs as part of `pnpm bump`, so the link lands in the Version Packages PR
 * alongside the notes it describes. The tag it points at does not exist yet at
 * that moment: `release-cli.yml` creates it after the publish. The link is dead
 * for the minutes in between and correct forever after, which is the accepted
 * trade rather than an oversight.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CHANGELOG = join(ROOT, "packages", "cli", "CHANGELOG.md");
const CLI_PACKAGE_JSON = join(ROOT, "packages", "cli", "package.json");

/**
 * The oldest release with a tag, so the oldest version that can be the LEFT
 * side of a compare link.
 *
 * Tagging began here: `v0.9.0` through `v0.10.2` were created retroactively,
 * and releases before `0.9.0` were never tagged and will not be. Emitting a
 * link whose left side is `v0.8.1` would produce a permanently broken URL,
 * which is worse than no link, so those headings are left alone.
 */
const FIRST_TAGGED = "0.9.0";

/** `## 1.2.3` at the start of a line. Changesets writes nothing else here. */
const HEADING = /^## (\d+\.\d+\.\d+)\s*$/;

/** A link this script already wrote, so a re-run is a no-op. */
const COMPARE_LINK = /^\[Compare with v\d+\.\d+\.\d+\]\(/;

/** Numeric ordering. Every version here is a plain release, never a prerelease. */
function isAtLeast(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0))
      return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

/**
 * Insert a compare link beneath every heading that has an older sibling, and
 * return the new text. Pure, so it can be exercised without touching the file.
 */
export function withCompareLinks(
  markdown: string,
  repositoryUrl: string
): string {
  const lines = markdown.split("\n");
  const headings: Array<{ index: number; version: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = HEADING.exec(line);
    if (match?.[1]) headings.push({ index, version: match[1] });
  }

  // Back to front, so an insertion never shifts an index still to be used.
  for (let position = headings.length - 2; position >= 0; position--) {
    const current = headings[position]!;
    const previous = headings[position + 1]!;
    if (!isAtLeast(previous.version, FIRST_TAGGED)) continue;

    // Idempotent: the first non-empty line after the heading decides.
    let cursor = current.index + 1;
    while (cursor < lines.length && lines[cursor]!.trim() === "") cursor++;
    if (COMPARE_LINK.test(lines[cursor] ?? "")) continue;

    const from = `v${previous.version}`;
    const to = `v${current.version}`;
    lines.splice(
      current.index + 1,
      0,
      "",
      `[Compare with ${from}](${repositoryUrl}/compare/${from}...${to})`
    );
  }

  return lines.join("\n");
}

/** `https://github.com/owner/repo`, from the package's own metadata. */
function repositoryUrl(): string {
  const manifest = JSON.parse(readFileSync(CLI_PACKAGE_JSON, "utf8")) as {
    repository?: { url?: string };
  };
  const raw = manifest.repository?.url;
  if (!raw) throw new Error("packages/cli/package.json has no repository.url");
  return raw.replace(/^git\+/, "").replace(/\.git$/, "");
}

const before = readFileSync(CHANGELOG, "utf8");
const after = withCompareLinks(before, repositoryUrl());
if (before === after) {
  console.log("CHANGELOG compare links: already up to date.");
} else {
  writeFileSync(CHANGELOG, after, "utf8");
  const added = after.split("\n").length - before.split("\n").length;
  console.log(`CHANGELOG compare links: added ${added / 2} link(s).`);
}
