import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  launcherFileName,
  launcherInvocation,
  renderLauncher,
  type LauncherPackage,
} from "../src/install/launcher";

/**
 * A stand-in for `npx` that reports what it was given. The launcher finds it
 * on `PATH` exactly as it would find the real one.
 */
const FAKE_NPX = `#!/usr/bin/env node
const out = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  launcher: process.env.TASKLESS_LAUNCHER,
};
process.stdout.write(JSON.stringify(out));
if (process.env.FAKE_NPX_SIGNAL) process.kill(process.pid, process.env.FAKE_NPX_SIGNAL);
process.exit(Number(process.env.FAKE_NPX_EXIT ?? 0));
`;

let root: string;
let fakeBin: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "taskless-launcher-"));
  fakeBin = join(root, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "npx"), FAKE_NPX);
  await chmod(join(fakeBin, "npx"), 0o755);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function install(
  packageName: LauncherPackage,
  manifest: unknown
): Promise<string> {
  const bin = join(root, ".taskless", "bin");
  await mkdir(bin, { recursive: true });
  if (manifest !== undefined) {
    await writeFile(
      join(root, ".taskless", "taskless.json"),
      JSON.stringify(manifest)
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
  options: { cwd?: string; env?: Record<string, string> } = {}
) {
  return spawnSync(path, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

function reported(stdout: string): {
  argv: string[];
  cwd: string;
  launcher: string;
} {
  return JSON.parse(stdout) as {
    argv: string[];
    cwd: string;
    launcher: string;
  };
}

describe.skipIf(process.platform === "win32")("project launcher", () => {
  it("runs the release's recorded version with every argument", async () => {
    const path = await install("@taskless/cli", {
      install: { launchers: { "@taskless/cli": "0.13.0" } },
    });
    const result = launch(path, ["check", "src/a file.ts", "--json"]);
    expect(result.status).toBe(0);
    expect(reported(result.stdout).argv).toEqual([
      "--yes",
      "@taskless/cli@0.13.0",
      "check",
      "src/a file.ts",
      "--json",
    ]);
  });

  it("names itself to the CLI it starts", async () => {
    const path = await install("@taskless/cli-nightly", {
      install: {
        launchers: { "@taskless/cli-nightly": "0.14.0-20261020120000xabc1234" },
      },
    });
    const result = launch(path, ["agent", "route"]);
    expect(reported(result.stdout).launcher).toBe(
      "./.taskless/bin/cli-nightly.mjs"
    );
    expect(reported(result.stdout).argv[1]).toBe(
      "@taskless/cli-nightly@0.14.0-20261020120000xabc1234"
    );
  });

  it("is not moved by a nightly install of the other package", async () => {
    const path = await install("@taskless/cli", {
      install: {
        cliVersion: "0.14.0-20261020120000xabc1234",
        launchers: { "@taskless/cli": "0.13.0" },
      },
    });
    expect(reported(launch(path, []).stdout).argv[1]).toBe(
      "@taskless/cli@0.13.0"
    );
  });

  it("falls back to cliVersion only when it is its own package's", async () => {
    const manifest = { install: { cliVersion: "0.13.0" } };
    const release = await install("@taskless/cli", manifest);
    expect(reported(launch(release, []).stdout).argv[1]).toBe(
      "@taskless/cli@0.13.0"
    );

    const nightly = await install("@taskless/cli-nightly", manifest);
    const result = launch(nightly, []);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("reads the manifest beside it when run from a subdirectory", async () => {
    const path = await install("@taskless/cli", {
      install: { launchers: { "@taskless/cli": "0.13.0" } },
    });
    const subdirectory = join(root, "src");
    await mkdir(subdirectory);
    const result = launch(path, ["check"], { cwd: subdirectory });
    expect(result.status).toBe(0);
    expect(reported(result.stdout).argv[1]).toBe("@taskless/cli@0.13.0");
    expect(reported(result.stdout).cwd).toMatch(/src$/);
  });

  it("passes the CLI's exit status back", async () => {
    const path = await install("@taskless/cli", {
      install: { launchers: { "@taskless/cli": "0.13.0" } },
    });
    expect(
      launch(path, ["check"], { env: { FAKE_NPX_EXIT: "1" } }).status
    ).toBe(1);
  });

  it("ends by the same signal that ended the CLI", async () => {
    const path = await install("@taskless/cli", {
      install: { launchers: { "@taskless/cli": "0.13.0" } },
    });
    const result = launch(path, ["check"], {
      env: { FAKE_NPX_SIGNAL: "SIGTERM" },
    });
    expect(result.signal).toBe("SIGTERM");
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
