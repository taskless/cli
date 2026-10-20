import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  launcherFileName,
  launcherInvocation,
  lockfilePath,
  renderLauncher,
  type LauncherPackage,
} from "../src/install/launcher";

/**
 * A stand-in for the installed CLI that reports what it was given. The fake
 * `npm ci` below installs it, so a test sees exactly what the launcher ran.
 */
const FAKE_CLI = `
const out = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  launcher: process.env.TASKLESS_LAUNCHER,
  version: require("./package.json").version,
};
process.stdout.write(JSON.stringify(out));
if (process.env.FAKE_CLI_SIGNAL) process.kill(process.pid, process.env.FAKE_CLI_SIGNAL);
process.exit(Number(process.env.FAKE_CLI_EXIT ?? 0));
`;

/**
 * A stand-in for `npm`, found on `PATH` exactly as the real one would be. It
 * logs each call, and for `npm ci` checks the lockfile against package.json as npm does, then
 * installs the fake CLI. It prints to standard output, as npm does, so a test
 * can check the launcher keeps that off the CLI's standard output.
 */
const FAKE_NPM = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const [command] = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({
  command,
  cwd: process.cwd(),
  npmrc: fs.existsSync(".npmrc") ? fs.readFileSync(".npmrc", "utf8") : null,
}) + "\n");
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write("npm error fake failure\n");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const [name, version] = Object.entries(manifest.dependencies)[0];
if (lock.packages["node_modules/" + name]?.version !== version) {
  process.stderr.write("npm error EUSAGE out of sync\n");
  process.exit(1);
}
const install = (root) => {
  const directory = path.join(root, "node_modules", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version, bin: { taskless: "./cli.cjs" } }));
  fs.writeFileSync(path.join(directory, "cli.cjs"), process.env.FAKE_CLI_SOURCE);
};
if (process.env.FAKE_NPM_RACE) install(process.env.FAKE_NPM_RACE);
if (!process.env.FAKE_NPM_NO_BIN) install(process.cwd());
process.stdout.write("added 1 package\n");
`;

let root: string;
let fakeBin: string;
let npmLog: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "taskless-launcher-"));
  fakeBin = join(root, "fake-bin");
  npmLog = join(root, "npm.log");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "npm"), FAKE_NPM);
  await chmod(join(fakeBin, "npm"), 0o755);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A lockfile pinning `packageName` at `version`, as `init` writes it. */
function lockfileFor(packageName: string, version: string): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [packageName]: version } },
      [`node_modules/${packageName}`]: { version },
    },
  });
}

async function install(
  packageName: LauncherPackage,
  manifest: unknown,
  lockedVersion?: string
): Promise<string> {
  const bin = join(root, ".taskless", "bin");
  await mkdir(bin, { recursive: true });
  if (manifest !== undefined) {
    await writeFile(
      join(root, ".taskless", "taskless.json"),
      JSON.stringify(manifest)
    );
  }
  if (lockedVersion !== undefined) {
    await writeFile(
      join(root, lockfilePath(packageName)),
      lockfileFor(packageName, lockedVersion)
    );
  }
  const path = join(bin, launcherFileName(packageName));
  await writeFile(path, renderLauncher(packageName));
  await chmod(path, 0o755);
  return path;
}

function launch(
  path: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; path?: string } = {}
) {
  return spawnSync(process.execPath, [path, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_NPM_LOG: npmLog,
      FAKE_CLI_SOURCE: FAKE_CLI,
      ...options.env,
      PATH: options.path ?? `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

function reported(stdout: string): {
  argv: string[];
  cwd: string;
  launcher: string;
  version: string;
} {
  return JSON.parse(stdout) as {
    argv: string[];
    cwd: string;
    launcher: string;
    version: string;
  };
}

async function npmCalls(): Promise<
  Array<{ command: string; cwd: string; npmrc: string | null }>
> {
  const log = await readFile(npmLog, "utf8").catch(() => "");
  return log
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          command: string;
          cwd: string;
          npmrc: string | null;
        }
    );
}

const CACHE = () => join(root, ".taskless", ".cache");

async function npmCommands(): Promise<string[]> {
  const calls = await npmCalls();
  return calls.map((call) => call.command);
}

async function listing(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.toSorted();
}
const RELEASE = { install: { launchers: { "@taskless/cli": "0.13.0" } } };

describe.skipIf(process.platform === "win32")("project launcher", () => {
  it("installs the recorded version once, then runs it with every argument", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");

    const first = launch(path, ["check", "src/a file.ts", "--json"]);
    expect(first.status).toBe(0);
    expect(reported(first.stdout)).toMatchObject({
      argv: ["check", "src/a file.ts", "--json"],
      version: "0.13.0",
    });
    expect(await npmCommands()).toEqual(["ci"]);
    await stat(join(CACHE(), "@taskless", "cli@0.13.0"));

    const second = launch(path, ["check"]);
    expect(second.status).toBe(0);
    expect(await npmCommands()).toHaveLength(1);
  });

  it("keeps npm's output off standard output", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    const result = launch(path, ["info", "--json"]);
    expect(() => reported(result.stdout)).not.toThrow();
    expect(result.stderr).toContain("added 1 package");
  });

  it("names itself to the CLI it starts", async () => {
    const version = "0.14.0-20261020120000xabc1234";
    const path = await install(
      "@taskless/cli-nightly",
      { install: { launchers: { "@taskless/cli-nightly": version } } },
      version
    );
    const result = launch(path, ["agent", "route"]);
    expect(reported(result.stdout).launcher).toBe(
      "./.taskless/bin/cli-nightly.mjs"
    );
    expect(reported(result.stdout).version).toBe(version);
  });

  it("is not moved by a nightly install of the other package", async () => {
    const path = await install(
      "@taskless/cli",
      {
        install: {
          cliVersion: "0.14.0-20261020120000xabc1234",
          launchers: { "@taskless/cli": "0.13.0" },
        },
      },
      "0.13.0"
    );
    expect(reported(launch(path, []).stdout).version).toBe("0.13.0");
  });

  it("falls back to cliVersion only when it is its own package's", async () => {
    const manifest = { install: { cliVersion: "0.13.0" } };
    const release = await install("@taskless/cli", manifest, "0.13.0");
    expect(reported(launch(release, []).stdout).version).toBe("0.13.0");

    const nightly = await install("@taskless/cli-nightly", manifest);
    const result = launch(nightly, []);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("reads the manifest and cache beside it when run from a subdirectory", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    const subdirectory = join(root, "src");
    await mkdir(subdirectory);
    const result = launch(path, ["check"], { cwd: subdirectory });
    expect(result.status).toBe(0);
    expect(reported(result.stdout).cwd).toMatch(/src$/);
    await stat(join(CACHE(), "@taskless", "cli@0.13.0"));
  });

  it("passes the CLI's exit status back", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    expect(
      launch(path, ["check"], { env: { FAKE_CLI_EXIT: "1" } }).status
    ).toBe(1);
  });

  it("ends by the same signal that ended the CLI", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    const result = launch(path, ["check"], {
      env: { FAKE_CLI_SIGNAL: "SIGTERM" },
    });
    expect(result.signal).toBe("SIGTERM");
  });

  it("ignores its own cache in git", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    launch(path, []);
    expect(await readFile(join(CACHE(), ".gitignore"), "utf8")).toBe("*\n");
  });

  it("installs with the nearest .npmrc above the project and does not keep it", async () => {
    await writeFile(join(root, ".npmrc"), "registry=http://127.0.0.1:9/\n");
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    launch(path, []);
    const calls = await npmCalls();
    const ci = calls.find((call) => call.command === "ci");
    expect(ci?.npmrc).toBe("registry=http://127.0.0.1:9/\n");
    await expect(
      stat(join(CACHE(), "@taskless", "cli@0.13.0", ".npmrc"))
    ).rejects.toThrow();
  });

  it("finds the .npmrc in a directory above the project", async () => {
    const project = join(root, "packages", "app");
    await mkdir(join(project, ".taskless", "bin"), { recursive: true });
    await writeFile(join(root, ".npmrc"), "registry=http://127.0.0.1:9/\n");
    await writeFile(
      join(project, ".taskless", "taskless.json"),
      JSON.stringify(RELEASE)
    );
    await writeFile(
      join(project, lockfilePath("@taskless/cli")),
      lockfileFor("@taskless/cli", "0.13.0")
    );
    const path = join(project, ".taskless", "bin", "cli.mjs");
    await writeFile(path, renderLauncher("@taskless/cli"));
    launch(path, [], { cwd: project });
    const calls = await npmCalls();
    expect(calls.find((call) => call.command === "ci")?.npmrc).toBe(
      "registry=http://127.0.0.1:9/\n"
    );
  });

  it("uses another run's install when it finished first", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    const target = join(CACHE(), "@taskless", "cli@0.13.0");
    const result = launch(path, [], { env: { FAKE_NPM_RACE: target } });
    expect(result.status).toBe(0);
    expect(reported(result.stdout).version).toBe("0.13.0");
    const entries = await listing(CACHE());
    expect(entries.filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  });

  it("drops the versions nothing records after installing a new one", async () => {
    await mkdir(join(CACHE(), "@taskless", "cli@0.12.0"), { recursive: true });
    await mkdir(
      join(CACHE(), "@taskless", "cli-nightly@0.14.0-20261020120000xabc1234"),
      { recursive: true }
    );
    const path = await install(
      "@taskless/cli",
      {
        install: {
          launchers: {
            "@taskless/cli": "0.13.0",
            "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234",
          },
        },
      },
      "0.13.0"
    );
    launch(path, []);
    expect(await listing(join(CACHE(), "@taskless"))).toEqual([
      "cli-nightly@0.14.0-20261020120000xabc1234",
      "cli@0.13.0",
    ]);
  });

  it("still drops old versions when a temporary install cannot be read", async () => {
    await mkdir(join(CACHE(), "@taskless", "cli@0.12.0"), { recursive: true });
    await symlink(join(root, "missing"), join(CACHE(), ".tmp-dangling"));
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    expect(launch(path, []).status).toBe(0);
    expect(await listing(join(CACHE(), "@taskless"))).toEqual(["cli@0.13.0"]);
  });

  it.each([
    ["no manifest", undefined],
    ["a manifest that does not parse", "{"],
    ["no version for its package", { install: { launchers: {} } }],
    [
      "a version that is not a version",
      { install: { launchers: { "@taskless/cli": "latest & calc" } } },
    ],
  ])("runs nothing and says why with %s", async (_label, manifest) => {
    const path = await install(
      "@taskless/cli",
      typeof manifest === "string" ? undefined : manifest
    );
    if (typeof manifest === "string") {
      await writeFile(join(root, ".taskless", "taskless.json"), manifest);
    }
    const result = launch(path, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(".taskless/taskless.json");
    expect(result.stderr).toContain("npx @taskless/cli@latest");
    expect(await npmCalls()).toEqual([]);
  });

  it.each([
    ["no lockfile", undefined],
    ["a lockfile for another version", "0.12.0"],
  ])("installs nothing with %s", async (_label, lockedVersion) => {
    const path = await install("@taskless/cli", RELEASE, lockedVersion);
    const result = launch(path, ["check"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(".taskless/bin/cli.lock.json");
    expect(result.stderr).toContain("npx @taskless/cli@latest");
    expect(await npmCalls()).toEqual([]);
  });

  it.each([
    ["npm fails", { FAKE_NPM_FAIL: "1" }, "npm could not install"],
    [
      "the install has no command",
      { FAKE_NPM_NO_BIN: "1" },
      "installed without its command",
    ],
  ])(
    "runs nothing and leaves no install when %s",
    async (_label, env, message) => {
      const path = await install("@taskless/cli", RELEASE, "0.13.0");
      const result = launch(path, ["check"], { env });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(result.stderr).toContain("@taskless/cli@0.13.0");
      expect(await listing(CACHE())).toEqual([".gitignore"]);
    }
  );

  it("says npm is needed when it is not on PATH", async () => {
    const path = await install("@taskless/cli", RELEASE, "0.13.0");
    const empty = join(root, "empty-bin");
    await mkdir(empty);
    const result = launch(path, ["check"], { path: empty });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "npm is needed to install @taskless/cli@0.13.0"
    );
    expect(await listing(CACHE())).toEqual([".gitignore"]);
  });
});

describe("launcher source", () => {
  it.each(["@taskless/cli", "@taskless/cli-nightly"] as const)(
    "%s starts with a node shebang and names its own package",
    (packageName) => {
      const source = renderLauncher(packageName);
      expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
      expect(source).toContain(`const PACKAGE = "${packageName}";`);
      expect(source).not.toContain("%(");
    }
  );

  it("describes itself plainly", () => {
    const comments = renderLauncher("@taskless/cli")
      .split("\n")
      .filter((line) => line.trimStart().startsWith("//"))
      .join("\n");
    expect(comments).toContain(".taskless/taskless.json");
    expect(comments).toContain(".taskless/.cache/");
    expect(comments).toContain("@taskless/cli");
    expect(comments).not.toMatch(/bypass|classifier|auto mode/i);
  });

  it("is spelled from the project root", () => {
    expect(launcherInvocation("@taskless/cli")).toBe("./.taskless/bin/cli.mjs");
    expect(launcherInvocation("@taskless/cli-nightly")).toBe(
      "./.taskless/bin/cli-nightly.mjs"
    );
  });
});
