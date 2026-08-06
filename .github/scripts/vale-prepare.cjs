#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Vale platform packages — fetch, verify, unpack, stamp, pack.
 *
 * This is the I/O half of the publish phase. Every decision it makes is
 * delegated to vale-release.cjs, which is pure and unit-tested; what lives here
 * is only the network and filesystem work that cannot be.
 *
 * The order of operations is the point, and it is the order the requirement
 * "verification occurs before any step holding publish credentials handles the
 * binary" (design D6) demands:
 *
 *   1. download the upstream release ARCHIVE into a temporary directory;
 *   2. sha256 it and compare against the digest committed in
 *      vale-manifest.json — abort the whole run on the first mismatch, before
 *      anything is unpacked, so unverified bytes are never even expanded onto
 *      disk;
 *   3. unpack the single executable named by the manifest into its package
 *      directory at mode 0755;
 *   4. stamp every package.json with one shared version;
 *   5. `npm pack` each package into --out.
 *
 * Nothing here publishes, and nothing here needs a credential. The workflow
 * runs it in a job that holds neither an npm identity nor an OIDC token, and
 * hands the resulting tarballs to a separate credentialed job. That job then
 * only ever sees bytes that already matched a reviewed digest and are already
 * sealed into a tarball.
 *
 * Usage:
 *   node .github/scripts/vale-prepare.cjs [--out <dir>] [--only <package>]... [--skip-pack]
 *
 *   --out        where to write the .tgz files (default: .vale-dist at the repo root)
 *   --only       restrict to one platform package; repeatable. Accepts the full
 *                name (@taskless/vale-linux-x64) or the suffix (linux-x64).
 *   --skip-pack  fetch, verify, unpack, and stamp, but do not run npm pack.
 *
 * Running this locally leaves the stamped version in each package.json and the
 * unpacked executable in each package directory. Both are throwaway: the
 * executable is gitignored, and checking the platform package.json files back
 * out of git puts the placeholder version back.
 */

const { createHash } = require("node:crypto");
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  applyStamp,
  assertChecksum,
  assertManifest,
  planStamp,
  resolveAssetName,
  resolveDownloadUrl,
} = require("./vale-release.cjs");

const REPO_ROOT = resolve(__dirname, "..", "..");
const MANIFEST_PATH = join(__dirname, "vale-manifest.json");

function parseArguments(argv) {
  const options = { out: join(REPO_ROOT, ".vale-dist"), only: [], pack: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      index += 1;
      options.out = resolve(argv[index] ?? "");
    } else if (argument === "--only") {
      index += 1;
      options.only.push(String(argv[index] ?? ""));
    } else if (argument === "--skip-pack") {
      options.pack = false;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

/** Match `--only` against either the full package name or its suffix. */
function selects(only, platform) {
  if (only.length === 0) {
    return true;
  }
  const suffix = platform.package.replace("@taskless/vale-", "");
  return only.some(
    (entry) =>
      entry === platform.package ||
      entry === suffix ||
      entry === `vale-${suffix}`
  );
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} exited with status ${result.status}`
    );
  }
  return result;
}

/** Download to a file and return its sha256, without unpacking anything. */
async function download(url, destinationPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} responded ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destinationPath, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Unpack exactly one member from an archive and place it at `destinationPath`
 * with mode 0755.
 *
 * `tar` and `unzip` are used rather than a bundled extraction library because
 * this file must stay dependency-free and both are present on the runner. The
 * archive path and member name come from the reviewed manifest and are passed
 * as argv (never through a shell), so neither can inject a command.
 *
 * The mode is set explicitly rather than inherited. Upstream's tarballs already
 * carry `-rwxr-xr-x`, but a zip has no reliable Unix mode, and the executable
 * bit surviving into the published tarball is a requirement rather than
 * something to leave to the archive format.
 */
function unpackMember(archivePath, member, destinationPath) {
  const workDirectory = mkdtempSync(join(tmpdir(), "vale-unpack-"));
  try {
    if (archivePath.endsWith(".zip")) {
      run("unzip", ["-o", "-q", archivePath, member, "-d", workDirectory]);
    } else {
      run("tar", ["-xzf", archivePath, "-C", workDirectory, member]);
    }
    const extracted = join(workDirectory, member);
    if (!existsSync(extracted)) {
      throw new Error(
        `${basename(archivePath)} contains no member named ${member}`
      );
    }
    copyFileSync(extracted, destinationPath);
    chmodSync(destinationPath, 0o755);
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = assertManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  );
  const selected = manifest.platforms.filter((platform) =>
    selects(options.only, platform)
  );
  if (selected.length === 0) {
    throw new Error(`--only matched no platform in ${MANIFEST_PATH}`);
  }

  // One version for the whole set, computed once from the run's start time.
  const plan = planStamp({ manifest, date: new Date() });
  console.log(`Vale ${manifest.valeVersion} → version ${plan.version}`);

  mkdirSync(options.out, { recursive: true });
  const downloadDirectory = mkdtempSync(join(tmpdir(), "vale-download-"));
  const packed = [];

  try {
    for (const platform of selected) {
      const asset = resolveAssetName(manifest, platform);
      const url = resolveDownloadUrl(manifest, platform);
      const archivePath = join(downloadDirectory, asset);

      console.log(`\n${platform.package}`);
      console.log(`  fetch    ${url}`);
      const actual = await download(url, archivePath);

      // Fatal on mismatch: the loop stops here, nothing is unpacked, and no
      // tarball reaches the credentialed job.
      assertChecksum({ asset, expected: platform.sha256, actual });
      console.log(`  verify   sha256 ${actual}`);

      const packageDirectory = join(REPO_ROOT, platform.directory);
      const binaryPath = join(packageDirectory, platform.archiveMember);
      unpackMember(archivePath, platform.archiveMember, binaryPath);
      console.log(
        `  unpack   ${platform.directory}/${platform.archiveMember} (0755)`
      );

      const packageJsonPath = join(packageDirectory, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      writeFileSync(
        packageJsonPath,
        `${JSON.stringify(applyStamp(packageJson, plan.version), null, 2)}\n`
      );
      console.log(`  stamp    ${plan.version}`);

      if (options.pack) {
        run(
          "npm",
          ["pack", "--ignore-scripts", "--pack-destination", options.out],
          { cwd: packageDirectory }
        );
        packed.push(platform.package);
      }
    }
  } finally {
    rmSync(downloadDirectory, { recursive: true, force: true });
  }

  console.log(
    `\nPrepared ${selected.length} package(s) at ${plan.version}` +
      (options.pack ? `; ${packed.length} tarball(s) in ${options.out}` : "")
  );
  setOutput("version", plan.version);
  setOutput("vale_version", manifest.valeVersion);
}

main().catch((error) => {
  console.error(`\nvale-prepare failed: ${error.message}`);
  process.exitCode = 1;
});
