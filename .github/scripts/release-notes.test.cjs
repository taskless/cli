// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for release-notes.cjs.
 *
 * The rendering is what is worth pinning down. These notes are third-party
 * Markdown pasted into a body that a workflow composes, so the two failures
 * that matter are structural: upstream restructuring the body around it, and
 * upstream being long enough to push the body past GitHub's 65536-character
 * cap, which fails the API call outright rather than truncating.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  NOTES_LIMIT,
  fetchLatestRelease,
  formatReleaseNotes,
  readNotesOut,
  writeNotesFile,
} = require("./release-notes.cjs");

const release = (notes) => ({
  tag: "v3.21.0",
  notes,
  url: "https://github.com/errata-ai/vale/releases/tag/v3.21.0",
});

test("notes: the section names the version and links the release", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release("Some change."),
  });
  assert.match(section, /^## Upstream release notes — 3\.21\.0$/m);
  assert.match(
    section,
    /^https:\/\/github\.com\/errata-ai\/vale\/releases\/tag\/v3\.21\.0$/m
  );
  assert.match(section, /^> Some change\.$/m);
});

/**
 * The reason every line is quoted. An upstream body that opens a fence and
 * never closes it would otherwise swallow whatever the workflow appends after
 * it — in the Vale case, nothing, but in the ast-grep case the body is composed
 * the other way round and a runaway fence eats the preamble.
 */
test("notes: an unterminated fence cannot escape the quoted block", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release("```yaml\nscope: sentence"),
  });
  for (const line of section.split("\n").slice(4)) {
    if (line.length > 0) {
      assert.match(line, /^>/, `unquoted line escaped the block: ${line}`);
    }
  }
});

test("notes: blank lines stay blank rather than becoming trailing spaces", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release("First.\n\nSecond."),
  });
  assert.match(section, /^>$/m);
  assert.doesNotMatch(section, /> $/m);
});

test("notes: a long body is truncated with a pointer to the rest", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release(`${"line\n".repeat(200)}`),
    limit: 100,
  });
  assert.match(section, /Truncated at 100 characters/);
  assert.match(section, /Read the rest at https:\/\/github\.com/);
  assert.ok(
    section.length < 400,
    `expected the kept text to be bounded, got ${section.length} characters`
  );
});

test("notes: a single line over budget is cut rather than dropped", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release("x".repeat(500)),
    limit: 100,
  });
  assert.match(section, /^> x{98}$/m);
  assert.match(section, /Truncated at 100 characters/);
});

test("notes: the default limit leaves room under GitHub's body cap", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    // Worst case for the quoting: every line is one character, so every line
    // also carries two characters of blockquote marker.
    release: release(`${"x\n".repeat(NOTES_LIMIT)}`),
  });
  assert.ok(
    section.length < 65_536,
    `a body of ${section.length} characters would be rejected by the API`
  );
});

/**
 * Both cases render a section rather than nothing. "Upstream wrote no notes"
 * and "we failed to fetch them" look identical when the section is simply
 * absent, and only one of those is fine.
 */
test("notes: a release with an empty body says so", () => {
  const section = formatReleaseNotes({
    repository: "errata-ai/vale",
    version: "3.21.0",
    release: release("   \n  "),
  });
  assert.match(section, /Upstream published no release notes/);
});

test("notes: no release at all falls back to the releases page", () => {
  const section = formatReleaseNotes({
    repository: "ast-grep/ast-grep",
    version: "0.45.3",
    release: undefined,
  });
  assert.match(section, /Upstream published no release notes/);
  assert.match(
    section,
    /^https:\/\/github\.com\/ast-grep\/ast-grep\/releases$/m
  );
});

test("notes: a 404 is not an error, because the version comparison stands", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });
  try {
    assert.equal(await fetchLatestRelease("ast-grep/ast-grep"), undefined);
  } finally {
    globalThis.fetch = previous;
  }
});

test("notes: any other API failure is an error", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 500 });
  try {
    await assert.rejects(
      fetchLatestRelease("ast-grep/ast-grep"),
      /responded 500/
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("notes: the written file always ends in a newline", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-notes-test-"));
  try {
    const path = join(directory, "notes.md");
    writeNotesFile(path, "no trailing newline");
    assert.equal(readFileSync(path, "utf8"), "no trailing newline\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Parsed here rather than in each detect script. All three parse the same flag
 * for the same reason, and a partial fix — one script taught a new form, two
 * not — would leave a workflow silently writing no notes.
 */
test("notes: --notes-out yields its path, and its absence yields nothing", () => {
  assert.equal(
    readNotesOut(["--write", "--notes-out", "/tmp/n.md"]),
    "/tmp/n.md"
  );
  assert.equal(readNotesOut(["--write"]), undefined);
});

test("notes: a flag where the path should be is a mistake, not a filename", () => {
  // `--notes-out --write` would otherwise write to a file named `--write` and
  // drop the flag meant to do the work.
  assert.throws(() => readNotesOut(["--notes-out", "--write"]), /needs a path/);
  assert.throws(() => readNotesOut(["--notes-out"]), /needs a path/);
});
