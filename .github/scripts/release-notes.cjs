#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Upstream release notes, fetched and rendered for a pull request or issue body.
 *
 * WHY THIS EXISTS. Both detect scripts answer "is upstream ahead?" with a
 * version number, and a version number is not enough to review a bump. A
 * reviewer looking at `3.20.0 -> 3.21.0` and six changed digests has no way to
 * tell a security fix from a docs release without leaving the pull request and
 * going to find the changelog by hand. Carrying the notes into the body is the
 * difference between reviewing a bump and approving one.
 *
 * THE NOTES ARE UNTRUSTED TEXT. They are Markdown written by a third party and
 * they reach a body that a workflow composes. Nothing here interpolates them
 * into a shell command, a `${{ }}` expression, or a $GITHUB_OUTPUT line — a
 * release body is free to contain a heredoc terminator or an output delimiter,
 * and either one is an injection if it meets a shell. `writeNotesFile` puts
 * them on disk and the workflow passes that path to `--body-file`, so the bytes
 * never pass through an interpreter.
 *
 * They are also FENCED when rendered. An upstream body that opens a fence and
 * never closes it, or that ends mid-table, would otherwise swallow whatever the
 * workflow appends after it. Quoting the whole block as Markdown blockquote
 * lines keeps the surrounding body's structure independent of what upstream
 * wrote, at the cost of one level of indentation in the rendering.
 */

const { writeFileSync } = require("node:fs");

/**
 * How much of an upstream body to carry, measured AFTER quoting.
 *
 * A GitHub pull request or issue body caps at 65536 characters, and a body that
 * hits the cap fails the API call rather than truncating — so the whole
 * proposal is lost to a talkative release. The limit is well under the cap
 * because the workflow's own preamble and the truncation footer have to fit
 * alongside it.
 *
 * Measured after quoting because the two differ by more than a rounding error:
 * every line gains two characters of blockquote marker, so a release whose
 * notes are a long list of short lines — which is exactly what ast-grep's
 * generated changelog is — nearly doubles. Budgeting against the source length
 * let a 40000-character body render as 80202, over the cap the limit exists to
 * stay under.
 */
const NOTES_LIMIT = 40_000;

/**
 * Fetch a release from the GitHub API.
 *
 * `reference` is either `latest` or `tags/<tag>`, matching the two endpoint
 * shapes. GITHUB_TOKEN, when present, is only for the rate limit; both
 * endpoints are public.
 *
 * A missing release is NOT an error. Upstream may tag without publishing a
 * release, or name its tags differently from its npm versions, and neither is a
 * reason to fail a detect run whose actual job — comparing versions — already
 * succeeded. The caller gets `undefined` and says so in the body.
 */
async function fetchRelease(repository, reference) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "taskless-release-notes",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const url = `https://api.github.com/repos/${repository}/releases/${reference}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const release = await response.json();
  if (typeof release.tag_name !== "string") {
    throw new TypeError(`${url} returned no tag_name`);
  }
  return {
    tag: release.tag_name,
    notes: typeof release.body === "string" ? release.body : "",
    url: typeof release.html_url === "string" ? release.html_url : undefined,
  };
}

/** The latest non-prerelease, non-draft release. */
const fetchLatestRelease = (repository) => fetchRelease(repository, "latest");

/** A specific release by tag, for upstreams whose version we learn elsewhere. */
const fetchReleaseByTag = (repository, tag) =>
  fetchRelease(repository, `tags/${encodeURIComponent(tag)}`);

/**
 * Render a release as a Markdown section, quoted so it cannot restructure the
 * body around it.
 *
 * `release` may be undefined (no release found) and its `notes` may be empty (a
 * release published with no body). Both render as a line saying so plus a link,
 * rather than as an absent section — "upstream wrote no notes" and "we forgot
 * to fetch them" look identical otherwise, and only one of them is fine.
 */
function formatReleaseNotes({
  repository,
  version,
  release,
  limit = NOTES_LIMIT,
}) {
  const link = release?.url ?? `https://github.com/${repository}/releases`;
  const heading = `## Upstream release notes — ${version}\n\n${link}\n`;

  const body = release?.notes?.trim() ?? "";
  if (body.length === 0) {
    return `${heading}\nUpstream published no release notes for this version.\n`;
  }

  // Truncation happens on a line boundary, so the rendering cannot end
  // mid-marker and produce a line that is not part of the quoted block.
  const lines = body
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"));
  const kept = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit) {
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  let truncated = kept.length < lines.length;
  // A first line longer than the whole budget keeps nothing, which would render
  // a truncation footer under an empty quote. Cut inside that line instead: a
  // release whose notes are one enormous paragraph still says something. This
  // is also truncation, even when it drops no whole line.
  if (kept.length === 0) {
    kept.push(lines[0].slice(0, limit));
    truncated = true;
  }
  const quoted = kept.join("\n");

  const footer = truncated
    ? `\n\n_Truncated at ${limit} characters. Read the rest at ${link}._\n`
    : "\n";
  return `${heading}\n${quoted}\n${footer}`;
}

/**
 * Read `--notes-out <path>` from an argv array, or undefined when absent.
 *
 * Lives here rather than in each detect script because all three parse the same
 * flag for the same reason, and a change to how it is parsed — accepting
 * `--notes-out=path`, say — should not be a change three files have to make in
 * agreement. A partial fix would leave one workflow silently writing nothing.
 *
 * A following value that looks like another flag is an error rather than a
 * path. `--notes-out --write` is a caller that forgot the argument, and taking
 * `--write` as a filename would write release notes to a file named `--write`
 * and drop the flag that was meant to do the work.
 */
function readNotesOut(argv) {
  const at = argv.indexOf("--notes-out");
  if (at === -1) {
    return undefined;
  }
  const path = argv[at + 1];
  if (!path || path.startsWith("--")) {
    throw new Error("--notes-out needs a path");
  }
  return path;
}

/** Write a rendered section to disk for a workflow to pass to `--body-file`. */
function writeNotesFile(path, section) {
  writeFileSync(path, section.endsWith("\n") ? section : `${section}\n`);
}

module.exports = {
  NOTES_LIMIT,
  fetchLatestRelease,
  fetchReleaseByTag,
  formatReleaseNotes,
  readNotesOut,
  writeNotesFile,
};
