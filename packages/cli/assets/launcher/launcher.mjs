#!/usr/bin/env node
// Runs the Taskless CLI package %(TASKLESS_PACKAGE)s at the version this
// project recorded for it in .taskless/taskless.json (`install.launchers`).
// Written by the Taskless installer, which replaces any edits on its next run.
// Run it from the directory that contains .taskless/.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE = "%(TASKLESS_PACKAGE)s";

const self = fileURLToPath(import.meta.url);
const manifest = join(dirname(dirname(self)), "taskless.json");

// A release version has no prerelease part; a nightly version always does.
const NIGHTLY = PACKAGE.endsWith("-nightly");
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i;

/** This package's recorded version, or undefined when none is usable. */
function recordedVersion() {
  let install;
  try {
    install = JSON.parse(readFileSync(manifest, "utf8"))?.install;
  } catch {
    return undefined;
  }
  const recorded = install?.launchers?.[PACKAGE];
  if (typeof recorded === "string" && VERSION.test(recorded)) return recorded;
  // A manifest written before `install.launchers` existed, or rewritten by a
  // CLI that does not know it, still records the last installed version.
  const last = install?.cliVersion;
  if (
    typeof last === "string" &&
    VERSION.test(last) &&
    last.includes("-") === NIGHTLY
  ) {
    return last;
  }
  return undefined;
}

// cmd.exe quoting for a batch file such as npx.cmd: each argument is quoted,
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

function run(version) {
  const command = "npx";
  const args = ["--yes", `${PACKAGE}@${version}`, ...process.argv.slice(2)];
  const options = {
    stdio: "inherit",
    env: {
      ...process.env,
      TASKLESS_LAUNCHER: `./.taskless/bin/${basename(self)}`,
    },
  };
  if (process.platform !== "win32") return spawnSync(command, args, options);
  const line = [command, ...args.map((argument) => quoteForCmd(argument))].join(
    " "
  );
  return spawnSync(
    process.env.comspec ?? "cmd.exe",
    ["/d", "/s", "/c", `"${line}"`],
    {
      ...options,
      windowsVerbatimArguments: true,
    }
  );
}

const version = recordedVersion();
if (version === undefined) {
  process.stderr.write(
    `taskless: no ${PACKAGE} version is recorded in ${manifest}. ` +
      `Run \`npx ${PACKAGE}@latest\` from the directory that contains .taskless/ to record one.\n`
  );
  process.exit(1);
}

const result = run(version);
if (result.error !== undefined) {
  process.stderr.write(
    `taskless: could not start npx: ${result.error.message}\n`
  );
  process.exit(1);
}
if (result.signal !== null) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
