// SPDX-License-Identifier: MIT
"use strict";

/**
 * Composition tests for vale-detect.cjs.
 *
 * vale-release.test.cjs covers the pure functions individually. This file
 * covers the one thing that cannot: how main() sequences them, with both
 * network calls stubbed. That gap is not hypothetical — the detect job once
 * routed its cheap "is upstream ahead?" check through planManifestUpdate with
 * an empty checksums payload, which throws on precisely the ahead path, so the
 * job failed on every run that had a release to propose while the no-op path
 * kept passing. Every function involved was green in isolation.
 *
 * Nothing here writes: main() is called without `--write`, so the committed
 * manifest is only read.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { main } = require("./vale-detect.cjs");
const { applyTemplate } = require("./vale-release.cjs");

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "vale-manifest.json"), "utf8")
);

/** A digest that is syntactically valid and obviously synthetic. */
const digestFor = (index) =>
  String(index + 1)
    .repeat(64)
    .slice(0, 64);

/** Upstream's sha256sum-format checksums file for a given Vale version. */
function checksumsFor(version) {
  return `${MANIFEST.platforms
    .map(
      (platform, index) =>
        `${digestFor(index)}  ${applyTemplate(platform.asset, { version })}`
    )
    .join("\n")}\n`;
}

/**
 * Run main() with both fetches stubbed and $GITHUB_OUTPUT pointed at a temp
 * file, then return the parsed step outputs plus which URLs were fetched.
 */
async function runDetect({
  upstreamTag,
  notes = "",
  checksums,
  argv = [],
  wantNotes = false,
}) {
  const directory = mkdtempSync(join(tmpdir(), "vale-detect-test-"));
  const outputPath = join(directory, "github-output");
  const notesPath = join(directory, "release-notes.md");
  const fullArgv = wantNotes ? [...argv, "--notes-out", notesPath] : argv;
  const previous = process.env.GITHUB_OUTPUT;
  const fetched = [];
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    const comparison = await main({
      argv: fullArgv,
      latestRelease: async () => ({
        tag: upstreamTag,
        notes,
        url: `https://github.com/${MANIFEST.upstream.repository}/releases/tag/${upstreamTag}`,
      }),
      text: async (url) => {
        fetched.push(url);
        return checksums;
      },
    });
    const outputs = Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        })
    );
    // Read before the finally below removes the directory. `undefined` means
    // the script wrote nothing, which is a distinct answer from an empty file.
    let notesWritten;
    if (wantNotes) {
      try {
        notesWritten = readFileSync(notesPath, "utf8");
      } catch {
        notesWritten = undefined;
      }
    }
    return { comparison, outputs, fetched, notesWritten };
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("detect: an upstream release ahead of the pin plans an update", async () => {
  // The regression case. Before the fix this rejected with "upstream checksums
  // file for 3.99.0 parsed to no entries" — the detect job's failure mode on
  // every real upstream bump.
  const { outputs, fetched } = await runDetect({
    upstreamTag: "v3.99.0",
    checksums: checksumsFor("3.99.0"),
  });

  assert.equal(outputs.update, "true");
  assert.equal(outputs.vale_version, "3.99.0");
  assert.equal(outputs.pinned_version, MANIFEST.valeVersion);
  assert.deepEqual(fetched, [
    `https://github.com/${MANIFEST.upstream.repository}/releases/download/v3.99.0/vale_3.99.0_checksums.txt`,
  ]);
});

test("detect: the pinned version being current is a no-op", async () => {
  const { outputs, fetched } = await runDetect({
    upstreamTag: `v${MANIFEST.valeVersion}`,
    checksums: "",
  });

  assert.equal(outputs.update, "false");
  assert.equal(outputs.vale_version, MANIFEST.valeVersion);
  assert.equal(outputs.pinned_version, MANIFEST.valeVersion);
  // The whole reason the check is cheap: no checksums file is downloaded for a
  // release we are not going to propose.
  assert.deepEqual(fetched, []);
});

test("detect: an upstream tag behind the pin is also a no-op", async () => {
  const { outputs, fetched } = await runDetect({
    upstreamTag: "v0.1.0",
    checksums: "",
  });

  assert.equal(outputs.update, "false");
  assert.deepEqual(fetched, []);
});

test("detect: --json reports the comparison without fetching checksums", async () => {
  // What update-badges.cjs consumes. It takes the RETURN value rather than the
  // printed line, but both are asserted here: the printed line is the contract
  // for anything calling the script from a shell.
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  let result;
  try {
    result = await runDetect({
      upstreamTag: "v3.99.0",
      checksums: "",
      argv: ["--json"],
    });
  } finally {
    console.log = original;
  }

  assert.deepEqual(result.comparison, {
    pinned: MANIFEST.valeVersion,
    upstream: "3.99.0",
    ahead: true,
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), result.comparison);
  // The badge needs the comparison, not the digests, so the ahead path stops
  // before the download the manifest proposal would need.
  assert.deepEqual(result.fetched, []);
  assert.equal(result.outputs.update, "true");
});

test("detect: --json refuses to be combined with --write", async () => {
  await assert.rejects(
    runDetect({
      upstreamTag: "v3.99.0",
      checksums: "",
      argv: ["--json", "--write"],
    }),
    /--json is read-only/
  );
});

test("detect: a checksums file missing a platform aborts", async () => {
  await assert.rejects(
    runDetect({
      upstreamTag: "v3.99.0",
      checksums: checksumsFor("3.99.0").split("\n").slice(1).join("\n"),
    }),
    /publishes no asset named/
  );
});

test("detect: --notes-out carries upstream's release notes for the proposal", async () => {
  const { notesWritten } = await runDetect({
    upstreamTag: "v3.99.0",
    notes: "## Fixed\n\nA thing that was broken.",
    checksums: checksumsFor("3.99.0"),
    wantNotes: true,
  });

  assert.match(notesWritten, /^## Upstream release notes — 3\.99\.0$/m);
  assert.match(notesWritten, /^> A thing that was broken\.$/m);
});

/**
 * The no-op path proposes nothing, so there is nothing to describe. Writing a
 * section anyway would leave the previous run's notes on disk for a workflow
 * step that only checks whether the file exists.
 */
test("detect: --notes-out writes nothing when upstream is not ahead", async () => {
  const { notesWritten } = await runDetect({
    upstreamTag: `v${MANIFEST.valeVersion}`,
    notes: "Should not be written.",
    checksums: "",
    wantNotes: true,
  });

  assert.equal(notesWritten, undefined);
});

test("detect: --json refuses to be combined with --notes-out", async () => {
  await assert.rejects(
    runDetect({
      upstreamTag: "v3.99.0",
      checksums: "",
      argv: ["--json"],
      wantNotes: true,
    }),
    /--json is read-only/
  );
});

test('detect: --notes-out without a path aborts rather than writing to "--write"', async () => {
  await assert.rejects(
    runDetect({
      upstreamTag: "v3.99.0",
      checksums: checksumsFor("3.99.0"),
      argv: ["--notes-out", "--write"],
    }),
    /--notes-out needs a path/
  );
});

/**
 * A repository with no published GitHub release at all. The comparison has
 * nothing to compare against, so failing loudly is the only honest answer —
 * reporting "not ahead" would read as "we are current" forever.
 */
test("detect: a repository with no releases aborts rather than reporting current", async () => {
  await assert.rejects(
    main({
      argv: [],
      latestRelease: async () => undefined,
      text: async () => "",
    }),
    /has no published releases/
  );
});
