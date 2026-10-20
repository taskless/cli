#!/usr/bin/env node
// Runs the Taskless CLI package %(TASKLESS_PACKAGE)s at the version this
// project recorded for it in .taskless/taskless.json (`install.launchers`).
// The first run of a version installs it into .taskless/.cache/ with
// `npm ci`, from the lockfile beside this file, so every machine installs the
// same dependency tree. Later runs start it from there without the network.
// Written by the Taskless installer, which replaces any edits on its next run.
// Run it from the directory that contains .taskless/.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE = "%(TASKLESS_PACKAGE)s";
// Both launcher packages, so pruning keeps the other one's installed version.
const PACKAGES = ["@taskless/cli", "@taskless/cli-nightly"];

const self = fileURLToPath(import.meta.url);
const tasklessDirectory = dirname(dirname(self));
const projectRoot = dirname(tasklessDirectory);
const manifest = join(tasklessDirectory, "taskless.json");
const lockfile = join(
  dirname(self),
  basename(self).replace(/\.mjs$/, ".lock.json")
);
const cache = join(tasklessDirectory, ".cache");
const INSTALLER = `npx ${PACKAGE}@latest`;

// A release version has no prerelease part; a nightly version always does.
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i;
// A temporary install this old is not still being written by anyone.
const STALE_INSTALL_MS = 60 * 60 * 1000;

function fail(message) {
  process.stderr.write(`taskless: ${message}\n`);
  process.exit(1);
}

/** The manifest's `install` block, or undefined when it cannot be read. */
function readInstall() {
  try {
    return JSON.parse(readFileSync(manifest, "utf8"))?.install;
  } catch {
    return undefined;
  }
}

/** A package's recorded version, or undefined when none is usable. */
function versionFor(install, name) {
  const recorded = install?.launchers?.[name];
  if (typeof recorded === "string" && VERSION.test(recorded)) return recorded;
  // A manifest written before `install.launchers` existed, or rewritten by a
  // CLI that does not know it, still records the last installed version.
  const last = install?.cliVersion;
  if (
    typeof last === "string" &&
    VERSION.test(last) &&
    last.includes("-") === name.endsWith("-nightly")
  ) {
    return last;
  }
  return undefined;
}

/** The installed package's bin script under `directory`, if it is there. */
function entryPoint(directory) {
  const packageDirectory = join(directory, "node_modules", PACKAGE);
  try {
    const { bin } = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8")
    );
    const relative =
      typeof bin === "string" ? bin : Object.values(bin ?? {})[0];
    if (typeof relative !== "string") return undefined;
    const path = join(packageDirectory, relative);
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

// cmd.exe quoting for a batch file such as npm.cmd: each argument is quoted,
// then every metacharacter is escaped twice, once for cmd.exe and once for
// the batch file's own parse. The same approach as cross-spawn (MIT).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function quoteForCmd(argument) {
  let quoted = argument
    .replaceAll(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`;
  return quoted.replaceAll(CMD_META, "^$1").replaceAll(CMD_META, "^$1");
}

function npm(args, options) {
  if (process.platform !== "win32") return spawnSync("npm", args, options);
  const line = ["npm", ...args.map((argument) => quoteForCmd(argument))].join(
    " "
  );
  return spawnSync(
    process.env.comspec ?? "cmd.exe",
    ["/d", "/s", "/c", `"${line}"`],
    { ...options, windowsVerbatimArguments: true }
  );
}

/** The `.npmrc` npx would read when run from the project root, if any. */
function projectNpmrc() {
  const result = npm(["prefix"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  const path = join(result.stdout.trim(), ".npmrc");
  return existsSync(path) ? path : undefined;
}

/** Install `version` into `target` from the lockfile; returns its entry point. */
function installVersion(version, target) {
  let lock;
  try {
    lock = readFileSync(lockfile, "utf8");
  } catch {
    fail(
      `${lockfile} is missing, so ${PACKAGE}@${version} cannot be installed ` +
        `as this project pinned it. Run \`${INSTALLER}\` from the directory ` +
        `that contains .taskless/ to write it.`
    );
  }
  let locked;
  try {
    locked = JSON.parse(lock)?.packages?.[`node_modules/${PACKAGE}`]?.version;
  } catch {
    locked = undefined;
  }
  if (locked !== version) {
    fail(
      `${lockfile} does not pin ${PACKAGE}@${version}, the version ` +
        `${manifest} records. Run \`${INSTALLER}\` from the directory that ` +
        `contains .taskless/ to rewrite both.`
    );
  }

  mkdirSync(cache, { recursive: true });
  const ignore = join(cache, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");

  const temporary = join(
    cache,
    `.tmp-${process.pid}-${randomBytes(4).toString("hex")}`
  );
  mkdirSync(temporary);
  const abandon = (message) => {
    rmSync(temporary, { recursive: true, force: true });
    fail(message);
  };

  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "taskless-launcher",
      private: true,
      dependencies: { [PACKAGE]: version },
    })
  );
  writeFileSync(join(temporary, "package-lock.json"), lock);
  // npm reads project settings only from the directory it installs into, so
  // the project's registry and credentials are copied in, and removed again
  // before the install is kept.
  const npmrc = projectNpmrc();
  if (npmrc !== undefined) copyFileSync(npmrc, join(temporary, ".npmrc"));

  process.stderr.write(`taskless: installing ${PACKAGE}@${version}\n`);
  // npm's output goes to standard error: standard output is the CLI's.
  const result = npm(
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: temporary, stdio: ["ignore", 2, 2] }
  );
  rmSync(join(temporary, ".npmrc"), { force: true });
  if (result.error !== undefined) {
    abandon(
      `npm is needed to install ${PACKAGE}@${version}, and it could not be ` +
        `started: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    abandon(`npm could not install ${PACKAGE}@${version}.`);
  }
  if (entryPoint(temporary) === undefined) {
    abandon(`${PACKAGE}@${version} installed without its command.`);
  }

  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(temporary, target);
  } catch (error) {
    // Another run installed the same version first; use its copy.
    rmSync(temporary, { recursive: true, force: true });
    if (entryPoint(target) === undefined) {
      fail(`could not install ${PACKAGE}@${version}: ${error.message}`);
    }
  }
  return entryPoint(target);
}

/**
 * Remove installed versions no package records, and temporary installs no
 * run is still writing. Anything that cannot be removed now, such as a file
 * Windows holds open, is left for the next run that installs.
 */
function prune(install) {
  const keep = new Set(
    PACKAGES.map((name) => {
      const version = versionFor(install, name);
      return version === undefined ? undefined : `${name}@${version}`;
    })
  );
  const remove = (path) => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Left for the next prune.
    }
  };
  try {
    for (const name of readdirSync(cache)) {
      const path = join(cache, name);
      if (
        name.startsWith(".tmp-") &&
        Date.now() - statSync(path).mtimeMs > STALE_INSTALL_MS
      ) {
        remove(path);
      }
    }
    for (const scope of new Set(PACKAGES.map((name) => name.split("/")[0]))) {
      const directory = join(cache, scope);
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory)) {
        const entry = `${scope}/${name}`;
        const ours = PACKAGES.some((pkg) => entry.startsWith(`${pkg}@`));
        if (ours && !keep.has(entry)) remove(join(directory, name));
      }
    }
  } catch {
    // Pruning never decides whether the CLI runs.
  }
}

const install = readInstall();
const version = versionFor(install, PACKAGE);
if (version === undefined) {
  fail(
    `no ${PACKAGE} version is recorded in ${manifest}. ` +
      `Run \`${INSTALLER}\` from the directory that contains .taskless/ to record one.`
  );
}

const target = join(cache, `${PACKAGE}@${version}`);
let entry = entryPoint(target);
if (entry === undefined) {
  entry = installVersion(version, target);
  prune(install);
}

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    TASKLESS_LAUNCHER: `./.taskless/bin/${basename(self)}`,
  },
});
if (result.error !== undefined) {
  fail(`could not start ${PACKAGE}@${version}: ${result.error.message}`);
}
if (result.signal !== null) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
