import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openRun, sweepAbandonedRuns } from "../src/rules/run-directory";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/** A pid that certainly belonged to a process that has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "0"]);
  return child.pid ?? 0;
}

async function runDirectories(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, ".taskless", ".run"), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe("run directories", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-run-dir-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("gives every run its own directory, owned by this process", async () => {
    const [a, b] = await Promise.all([openRun(cwd), openRun(cwd)]);
    try {
      expect(a.id).not.toBe(b.id);
      expect(a.id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{6}$/);
      const owner = JSON.parse(
        await readFile(join(a.path, "owner"), "utf8")
      ) as { pid: number; hostname: string };
      expect(owner).toMatchObject({ pid: process.pid, hostname: hostname() });
      expect(
        await readFile(join(cwd, ".taskless", ".run", ".gitignore"), "utf8")
      ).toBe("*\n");
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("removes the directory on close", async () => {
    const run = await openRun(cwd);
    run.logs.engine.write("hello");
    await run.close();
    expect(existsSync(run.path)).toBe(false);
    await run.close(); // idempotent
  });

  it("keeps the directory, logs flushed, when preserved", async () => {
    const run = await openRun(cwd, { preserve: true });
    run.logs.sg.write("$ sg scan");
    run.logs.vale.write("$ vale");
    run.logs.runtime.write("rule: 0 finding(s)");
    await run.close();
    expect(await readFile(join(run.path, "sg.log"), "utf8")).toContain(
      "$ sg scan"
    );
    expect(await readFile(join(run.path, "engine.log"), "utf8")).toContain(
      "directory preserved"
    );
  });

  it("sweeps a directory whose owner process is gone", async () => {
    const stale = join(cwd, ".taskless", ".run", "20200101T000000Z-aaaaaa");
    await mkdir(stale, { recursive: true });
    await writeFile(
      join(stale, "owner"),
      JSON.stringify({ pid: deadPid(), hostname: hostname(), startedAt: "x" })
    );
    expect(await sweepAbandonedRuns(cwd)).toEqual(["20200101T000000Z-aaaaaa"]);
    expect(existsSync(stale)).toBe(false);
  });

  it("never sweeps a live run, or one owned by another host", async () => {
    const live = await openRun(cwd);
    const foreign = join(cwd, ".taskless", ".run", "20200101T000000Z-bbbbbb");
    await mkdir(foreign, { recursive: true });
    await writeFile(
      join(foreign, "owner"),
      JSON.stringify({
        pid: deadPid(),
        hostname: "some-other-host",
        startedAt: "x",
      })
    );
    try {
      expect(await sweepAbandonedRuns(cwd)).toEqual([]);
      expect(existsSync(live.path)).toBe(true);
      expect(existsSync(foreign)).toBe(true);
    } finally {
      await live.close();
    }
  });

  it("sweeps the ownerless directories earlier versions left", async () => {
    for (const legacy of ["runtime-rules", "snapshot"]) {
      await mkdir(join(cwd, ".taskless", ".run", legacy, "x"), {
        recursive: true,
      });
    }
    const run = await openRun(cwd);
    await run.close();
    expect(await runDirectories(cwd)).toEqual([]);
  });

  it("does not rewrite a .gitignore that is already there", async () => {
    await mkdir(join(cwd, ".taskless", ".run"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", ".run", ".gitignore"),
      "*\n# kept\n"
    );
    const run = await openRun(cwd);
    await run.close();
    expect(
      await readFile(join(cwd, ".taskless", ".run", ".gitignore"), "utf8")
    ).toBe("*\n# kept\n");
  });
});

describe("check and its run directory", () => {
  const fixture = join(
    import.meta.dirname,
    "fixtures",
    "mixed-engines-project"
  );
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-run-check-"));
    await cp(fixture, cwd, { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd });
    await migrateFixture(["-d", cwd]);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function check(...extra: string[]) {
    const { stdout } = await execFileAsync(
      "node",
      [binPath, "check", "-d", cwd, "--json", ...extra],
      { env: { ...process.env, TASKLESS_TOKEN: "" } }
    ).catch((error: { stdout: string }) => ({ stdout: error.stdout }));
    const line = stdout
      .trim()
      .split("\n")
      .findLast((l) => l.startsWith("{"));
    const output = JSON.parse(line ?? "{}") as {
      results: { ruleId: string; file: string }[];
      runDirectory?: string;
    };
    // An error envelope has no `results`; a test must not pass on one.
    expect(output.results, stdout).toBeDefined();
    return output;
  }

  it("leaves nothing behind", async () => {
    await check();
    expect(await runDirectories(cwd)).toEqual([]);
  });

  it("concurrent checks do not disturb each other", async () => {
    const alone = await check();
    const key = (output: typeof alone) =>
      output.results.map((r) => `${r.file}:${r.ruleId}`).toSorted();
    const together = await Promise.all([check(), check(), check(), check()]);
    for (const output of together) {
      expect(key(output)).toEqual(key(alone));
    }
    expect(key(alone).length).toBeGreaterThan(0);
    expect(await runDirectories(cwd)).toEqual([]);
  });

  it("--preserve-logs keeps the run directory, snapshot, and logs, and names it", async () => {
    const output = await check("-l");
    expect(output.runDirectory).toMatch(
      /^\.taskless\/\.run\/\d{8}T\d{6}Z-[0-9a-f]{6}$/
    );
    const directory = join(cwd, output.runDirectory ?? "");
    const files = await readdir(directory);
    for (const name of [
      "engine.log",
      "sg.log",
      "vale.log",
      "owner",
      "snapshot",
    ]) {
      expect(files).toContain(name);
    }
    const sgLog = await readFile(join(directory, "sg.log"), "utf8");
    expect(sgLog).toContain("scan --config");
    expect(sgLog).toMatch(/exit \d/);
    expect(await readFile(join(directory, "engine.log"), "utf8")).toContain(
      "unverified run"
    );
    // The next run sweeps it only once its owner is gone, which it is.
    await check();
    expect(await runDirectories(cwd)).toEqual([]);
  });
});
