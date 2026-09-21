// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for vale-upgrade-detect.cjs — the consumer half of the Vale pipeline.
 *
 * The state worth guarding against here is not "we missed a release". It is
 * "we upgraded into a half-published set", which produces pins that resolve on
 * some platforms and 404 on others, and which no amount of local testing on one
 * machine would reveal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { baseVersion, collectPins, main } = require("./vale-upgrade-detect.cjs");

const MANIFEST = { upstream: { repository: "errata-ai/vale" } };

const PLATFORMS = [
  "@taskless/vale-darwin-arm64",
  "@taskless/vale-darwin-x64",
  "@taskless/vale-linux-arm64",
  "@taskless/vale-linux-x64",
  "@taskless/vale-win32-arm64",
  "@taskless/vale-win32-x64",
];

const pinnedAt = (version) => ({
  optionalDependencies: Object.fromEntries(
    PLATFORMS.map((name) => [name, version])
  ),
});

const sourcePinnedAt = (version) =>
  `${JSON.stringify(
    {
      name: "@taskless/cli",
      ...pinnedAt(version),
      dependencies: { zod: "^4" },
    },
    undefined,
    2
  )}\n`;

/**
 * A capabilities.ts with the declaration `--write` rewrites, plus the kind of
 * neighbour it must not touch: the ast-grep constant, and a docblock naming
 * the old version. The constant carries the BASE version; the stamp stays in
 * package.json.
 */
const CAPABILITIES_AT = (version) =>
  [
    "/** The tier table is a property of {@link VALE_VERSION}'s binary. */",
    `export const VALE_VERSION = "${version}";`,
    "",
    'export const AST_GREP_VERSION = "0.45.3";',
    "",
  ].join("\n");

async function run({
  packageJson,
  packageJsonSource,
  published,
  argv = [],
  release,
  wantNotes = false,
  capabilitiesSource = CAPABILITIES_AT("3.20.0"),
}) {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-test-"));
  const outputPath = join(directory, "github-output");
  const notesPath = join(directory, "release-notes.md");
  const packageJsonPath = join(directory, "package.json");
  if (packageJsonSource !== undefined) {
    writeFileSync(packageJsonPath, packageJsonSource);
  }
  // --write also rewrites VALE_VERSION, so the fixture carries a
  // capabilities.ts of its own. The committed one is never written to here.
  const capabilitiesPath = join(directory, "capabilities.ts");
  writeFileSync(capabilitiesPath, capabilitiesSource);
  const previous = process.env.GITHUB_OUTPUT;
  const tagsFetched = [];
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    const comparison = await main({
      argv: wantNotes ? [...argv, "--notes-out", notesPath] : argv,
      latestVersion: async (name) =>
        typeof published === "string" ? published : published[name],
      releaseFor: async (repository, tag) => {
        tagsFetched.push(`${repository}@${tag}`);
        return release;
      },
      packageJsonPath,
      packageJson,
      capabilitiesPath,
      manifest: MANIFEST,
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
    let notesWritten;
    if (wantNotes) {
      try {
        notesWritten = readFileSync(notesPath, "utf8");
      } catch {
        notesWritten = undefined;
      }
    }
    const written =
      packageJsonSource === undefined
        ? undefined
        : readFileSync(packageJsonPath, "utf8");
    const capabilitiesWritten = readFileSync(capabilitiesPath, "utf8");
    return {
      comparison,
      outputs,
      notesWritten,
      tagsFetched,
      written,
      capabilitiesWritten,
    };
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a newer published set is an upgrade", async () => {
  const { outputs } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    published: "3.21.0-20260914010203",
  });

  assert.equal(outputs.update, "true");
  assert.equal(outputs.vale_version, "3.21.0-20260914010203");
  assert.equal(outputs.pinned_version, "3.20.0-20260907164938");
  // The plain version is what the changelog and the release note talk about.
  assert.equal(outputs.base_version, "3.21.0");
});

test("the pins already matching what is published is a no-op", async () => {
  const { outputs } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    published: "3.20.0-20260907164938",
  });
  assert.equal(outputs.update, "false");
});

/**
 * Two stamps of the SAME upstream Vale version. Ordering by the base version
 * alone would call this equal and never ship a republish — which is a real
 * event here, since a repackaging fix keeps the upstream version and moves only
 * the stamp.
 */
test("a newer stamp of the same Vale version is still an upgrade", async () => {
  const { outputs } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    published: "3.20.0-20260908000000",
  });
  assert.equal(outputs.update, "true");
  assert.equal(outputs.base_version, "3.20.0");
});

/**
 * The failure this script exists to refuse. release-vale.yml publishes six
 * packages in a loop and can leave the set split across two versions if a
 * publish fails partway; upgrading into that pins some platforms to something
 * npm does not serve.
 */
test("a half-published set aborts rather than upgrading into it", async () => {
  await assert.rejects(
    run({
      packageJson: pinnedAt("3.20.0-20260907164938"),
      published: Object.fromEntries(
        PLATFORMS.map((name, index) => [
          name,
          index === 0 ? "3.21.0-20260914010203" : "3.20.0-20260907164938",
        ])
      ),
    }),
    /not at one version, so it is mid-publish or partially failed/
  );
});

test("pins that disagree with each other abort", () => {
  assert.throws(
    () =>
      collectPins({
        optionalDependencies: {
          "@taskless/vale-darwin-arm64": "3.20.0-20260907164938",
          "@taskless/vale-linux-x64": "3.19.0-20260901000817",
        },
      }),
    /pins disagree/
  );
});

test("an unstamped pin aborts, because it could never have been published", () => {
  assert.throws(
    () =>
      collectPins({
        optionalDependencies: { "@taskless/vale-linux-x64": "3.20.0" },
      }),
    /not a stamped version/
  );
});

test("--write moves every pin and nothing else", async () => {
  const { written } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    packageJsonSource: sourcePinnedAt("3.20.0-20260907164938"),
    published: "3.21.0-20260914010203",
    argv: ["--write"],
  });

  assert.equal(written.match(/3\.21\.0-20260914010203/g).length, 6);
  assert.doesNotMatch(written, /3\.20\.0-20260907164938/);
  assert.match(written, /"zod": "\^4"/);
});

/**
 * The constant is what `test/engine-version-consistency.test.ts` holds to the
 * pins, so it moves in the same write. It takes the BASE version — the one the
 * binary reports — not the stamped one npm serves, and nothing else in the
 * file moves with it.
 */
test("--write moves VALE_VERSION to the base version, not the stamp", async () => {
  const { capabilitiesWritten } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    packageJsonSource: sourcePinnedAt("3.20.0-20260907164938"),
    published: "3.21.0-20260914010203",
    argv: ["--write"],
  });

  assert.equal(capabilitiesWritten, CAPABILITIES_AT("3.21.0"));
  assert.doesNotMatch(capabilitiesWritten, /20260914010203/);
  assert.match(capabilitiesWritten, /AST_GREP_VERSION = "0\.45\.3"/);
});

test("--write leaves both files alone when the pins are current", async () => {
  const before = sourcePinnedAt("3.20.0-20260907164938");
  const { written, capabilitiesWritten } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    packageJsonSource: before,
    published: "3.20.0-20260907164938",
    argv: ["--write"],
  });

  assert.equal(written, before);
  assert.equal(capabilitiesWritten, CAPABILITIES_AT("3.20.0"));
});

/**
 * The declaration the workflow depends on has moved or been renamed. Failing
 * here is the point: pushing the pins without the constant is exactly the
 * red-by-construction pull request (taskless/cli#368) this rewrite ends.
 */
test("--write fails when VALE_VERSION is not declared exactly once", async () => {
  await assert.rejects(
    run({
      packageJson: pinnedAt("3.20.0-20260907164938"),
      packageJsonSource: sourcePinnedAt("3.20.0-20260907164938"),
      published: "3.21.0-20260914010203",
      argv: ["--write"],
      capabilitiesSource: 'export const AST_GREP_VERSION = "0.45.3";\n',
    }),
    /expected exactly one `export const VALE_VERSION = "…";` declaration, found 0/
  );
});

test("the changelog is upstream's, fetched by the BASE version's tag", async () => {
  const { notesWritten, tagsFetched } = await run({
    packageJson: pinnedAt("3.20.0-20260907164938"),
    published: "3.21.0-20260914010203",
    release: {
      tag: "v3.21.0",
      notes: "## `doc(...)` selections",
      url: "https://github.com/errata-ai/vale/releases/tag/v3.21.0",
    },
    wantNotes: true,
  });

  // Not the stamped version, which upstream has never heard of, and not a bare
  // `3.21.0`, which is not how Vale tags.
  assert.deepEqual(tagsFetched, ["errata-ai/vale@v3.21.0"]);
  assert.match(notesWritten, /^## Upstream release notes — 3\.21\.0$/m);
  assert.match(notesWritten, /> ## `doc\(\.\.\.\)` selections/);
});

test("base version strips the stamp", () => {
  assert.equal(baseVersion("3.21.0-20260914010203"), "3.21.0");
  assert.throws(() => baseVersion("3.21.0"), /not a stamped version/);
});
