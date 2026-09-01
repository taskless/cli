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
