import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

/**
 * A command that reports must not rewrite the repository.
 *
 * `check`, `verify` and `test` used to migrate `.taskless/` on their way to
 * doing their real work. `0005` moves and deletes tracked files, so running a
 * read-only command changed the working tree, with nothing on the human path to
 * say so — the diff landed in whatever commit came next, and in CI it happened
 * on every checkout.
 *
 * It also made a migration unverifiable. Comparing findings before and after is
 * impossible when asking the question performs the change, so a migration that
 * silently dropped a rule could not be caught by the one check that would catch
 * it.
 *
 * The cost is a wall the user meets once after an upgrade, where before they
 * met nothing. That is the visible version of the same event, and it is the
 * trade this CLI already makes for an unsupported request.
 */

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

const FLAT_RULE =
  "id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($A)\n";

describe("a reporting command never migrates", () => {
  let directory: string;
  let taskless: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-no-migrate-"));
    taskless = join(directory, ".taskless");
    await mkdir(join(taskless, "rules"), { recursive: true });
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 3, install: {} }),
      "utf8"
    );
    await writeFile(join(taskless, "rules", "no-eval.yml"), FLAT_RULE, "utf8");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["check", "verify", "test"] as const)(
    "%s leaves the working tree exactly as it found it",
    async (command) => {
      // The whole point. Not "it warns" — it must not have MOVED anything.
      const { exitCode } = await runCli([command, "-d", directory]);
      expect(exitCode).toBe(1);

      const manifest = JSON.parse(
        await readFile(join(taskless, "taskless.json"), "utf8")
      ) as { version: number };
      expect(manifest.version).toBe(3);
      await expect(
        stat(join(taskless, "rules", "no-eval.yml"))
      ).resolves.toBeDefined();
      // And nothing was created where the migration would have put it.
      await expect(stat(join(taskless, "rules", "sg"))).rejects.toThrow();
    }
  );

  it.each(["check", "verify", "test"] as const)(
    "%s names the command that fixes it",
    async (command) => {
      // A refusal that does not say what to run is just a wall.
      const { stderr } = await runCli([command, "-d", directory]);
      expect(stderr).toContain("schema version 3");
      expect(stderr).toContain(String(LATEST_SCHEMA_VERSION));
      expect(stderr).toMatch(/init/);
    }
  );

  it.each(["check", "verify", "test"] as const)(
    "%s --json carries the code an agent branches on",
    async (command) => {
      const { stdout } = await runCli([command, "--json", "-d", directory]);
      const envelope = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
        ok?: boolean;
        code?: string;
      };
      expect(envelope.ok).toBe(false);
      // Distinct from SCAFFOLD_VERSION_MISMATCH, which is the opposite
      // direction and asks the caller to upgrade the CLI instead.
      expect(envelope.code).toBe("SCAFFOLD_MIGRATION_REQUIRED");
    }
  );

  it.each(["check", "verify", "test"] as const)(
    "%s still refuses a scaffold NEWER than the CLI",
    async (command) => {
      // The opposite direction, and a regression this change introduced once.
      // `check` used to reach that refusal through `ensureTasklessDirectory`,
      // and dropping the call dropped the check with it: a version-99 scaffold
      // read as "nothing pending" and `check` reported "No rules configured"
      // for a layout it could not parse.
      await writeFile(
        join(taskless, "taskless.json"),
        JSON.stringify({ version: 99, install: {} }),
        "utf8"
      );

      const { stdout, stderr } = await runCli([
        command,
        "--json",
        "-d",
        directory,
      ]);
      const output = `${stdout}${stderr}`;
      expect(output).toContain("SCAFFOLD_VERSION_MISMATCH");
      expect(output).toMatch(/Upgrade the CLI/);
    }
  );

  it("proceeds past a newer scaffold when explicitly told to", async () => {
    // The documented escape hatch has to survive the refusal above, or the
    // flag is a promise the CLI stopped keeping.
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 99, install: {} }),
      "utf8"
    );

    const { stderr } = await runCli([
      "check",
      "-d",
      directory,
      "--allow-version-mismatches",
    ]);
    expect(stderr).not.toContain("SCAFFOLD_VERSION_MISMATCH");
  });

  it("still runs against a project that is already current", async () => {
    // The refusal is about being BEHIND, not about having a scaffold.
    await runCli(["init", "--no-interactive", "-d", directory]);

    const { stderr, exitCode } = await runCli(["check", "-d", directory]);
    expect(stderr).not.toContain("schema version");
    expect(exitCode).not.toBe(1);
  });

  it.each([
    ["verify", true],
    ["test", true],
  ])("%s --json keeps the scaffold migration off stderr", async (command) => {
    // The one path that still writes: scaffolding a brand-new project runs
    // every migration from 0, and its file-by-file summary is prose a
    // machine consumer cannot parse. It went to stderr unconditionally once
    // this call lost its notice handler.
    const bare = await mkdtemp(join(tmpdir(), "tskl-bare-json-"));
    try {
      const { stderr } = await runCli([command, "--json", "-d", bare]);
      expect(stderr).not.toContain("Migrating .taskless/");
      expect(stderr).not.toContain("Migrated .taskless/");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("still explains the scaffold migration to a person", async () => {
    // Suppressed for machines, not removed. Without `--json` the summary is
    // the only thing telling someone their working tree just changed.
    const bare = await mkdtemp(join(tmpdir(), "tskl-bare-human-"));
    try {
      const { stderr } = await runCli(["verify", "-d", bare]);
      expect(stderr).toContain("Migrating .taskless/");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("says nothing about schemas in a project with no .taskless at all", async () => {
    // Nothing to migrate, so nothing to refuse. `check` reports the absence of
    // rules, which is its existing behaviour and not this error.
    const bare = await mkdtemp(join(tmpdir(), "tskl-bare-"));
    try {
      const { stderr } = await runCli(["check", "-d", bare]);
      expect(stderr).not.toContain("schema version");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("migrates when asked, and reports what moved", async () => {
    // The other half of the trade: the migration still happens, on a command
    // whose job is to change the project.
    const { stdout } = await runCli([
      "init",
      "--no-interactive",
      "--json",
      "-d",
      directory,
    ]);

    const envelope = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
      migrated?: { from: number; to: number };
    };
    expect(envelope.migrated?.from).toBe(3);
    expect(envelope.migrated?.to).toBe(LATEST_SCHEMA_VERSION);
    await expect(
      stat(join(taskless, "rules", "sg", "no-eval", "no-eval.yml"))
    ).resolves.toBeDefined();
  });
});

/**
 * A manifest that cannot be parsed is a DIFFERENT failure from a manifest that
 * is behind, and it used to be reported as one (taskless/cli#278).
 *
 * `readRawManifest` collapsed unparseable JSON to `{version: 0}`, so a file
 * whose first line reads `"version": 6` produced "This project's .taskless/ is
 * at schema version 0, and this CLI expects 6". The number was invented, and
 * the remedy it named destroyed the file: `init` re-read the manifest (still
 * unparseable, still `{}`), stamped the version over the top, and wrote back
 * `{"version": 6}` with `install` and `rules` gone.
 */
describe("a manifest that cannot be parsed", () => {
  let directory: string;
  let taskless: string;

  /** The reproduction from the issue: a merge conflict left in the file. */
  const CORRUPT_MANIFEST =
    '{"version": 6,\n<<<<<<< HEAD\n' +
    '  "install": {"cliVersion": "0.11.0", "onboarded": true},\n' +
    '  "rules": {"reconciledTo": "0.11.0"}\n}\n';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-corrupt-manifest-"));
    taskless = join(directory, ".taskless");
    await mkdir(join(taskless, "rules"), { recursive: true });
    await writeFile(join(taskless, "taskless.json"), CORRUPT_MANIFEST, "utf8");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["check", "verify", "test"] as const)(
    "%s --json reports the file, not a version it guessed",
    async (command) => {
      const { stdout } = await runCli([command, "--json", "-d", directory]);
      const envelope = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
        ok?: boolean;
        code?: string;
        message?: string;
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe("SCAFFOLD_MANIFEST_UNREADABLE");
      expect(envelope.message).toContain("taskless.json");
      // The heart of the issue: the message may SAY this is not a version
      // mismatch, and it must never claim a version. Matched on the two
      // sentences that carry a number, in both directions, rather than on the
      // words, which the denial reuses.
      expect(envelope.message).not.toMatch(/at schema version \d/);
      expect(envelope.message).not.toMatch(/scaffold is version \d/);
    }
  );

  it("check does not tell a person to run the command that would overwrite it", async () => {
    const { stderr } = await runCli(["check", "-d", directory]);
    expect(stderr).toContain("could not be read");
    // `init` may be NAMED, since the message explains that it refuses here too.
    // What it must never be is the remedy, and the remedy is the last line.
    expect(stderr.trimEnd().split("\n").at(-1)).toContain("Repair the JSON");
  });

  it("init refuses rather than rewriting what it could not parse", async () => {
    const { exitCode } = await runCli([
      "init",
      "--no-interactive",
      "-d",
      directory,
    ]);
    expect(exitCode).toBe(1);

    // Byte-for-byte. Measured before the fix, this file came back as
    // `{"version": 6}` and both `install` and `rules` were gone.
    const after = await readFile(join(taskless, "taskless.json"), "utf8");
    expect(after).toBe(CORRUPT_MANIFEST);
  });

  it("still migrates a .taskless/ whose manifest is merely ABSENT", async () => {
    // The half that must not change. Absent is not a fault: it is the
    // pre-manifest layout, it reads as version 0, and version 0 is honest.
    const bare = await mkdtemp(join(tmpdir(), "tskl-no-manifest-"));
    try {
      await mkdir(join(bare, ".taskless", "rules"), { recursive: true });
      const { stdout } = await runCli([
        "init",
        "--no-interactive",
        "--json",
        "-d",
        bare,
      ]);
      const envelope = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
        migrated?: { from: number; to: number };
      };
      expect(envelope.migrated?.from).toBe(0);
      expect(envelope.migrated?.to).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
