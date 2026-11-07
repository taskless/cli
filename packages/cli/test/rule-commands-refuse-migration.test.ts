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
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

/**
 * The commands that write a served rule refuse a scaffold they would otherwise
 * migrate on the way to writing it.
 *
 * `rule create`, `improve`, `restore` and `rollback` reach the rule write path,
 * which settles the layout first, so on a behind scaffold they moved and
 * deleted tracked files as a side effect, after the service call. `init` is
 * the one command that migrates; these now refuse before any service call, the
 * same way `check`, `verify` and `report` do.
 */

const FLAT_RULE =
  "id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($A)\n";

const COMMANDS: Record<string, string[]> = {
  create: ["rule", "create", "--from", "request.json"],
  improve: ["rule", "improve", "--from", "request.json"],
  restore: ["rule", "restore", "no-eval"],
  rollback: ["rule", "rollback", "no-eval", "some-revision"],
};

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      // No override: the version-mismatch case must refuse. The refusal comes
      // before identity is resolved, so no credentials are needed either.
      env: {
        ...process.env,
        TASKLESS_TELEMETRY_DISABLED: "1",
        TASKLESS_ALLOW_VERSION_MISMATCHES: "",
      },
    });
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

describe("rule-writing commands never migrate", () => {
  let directory: string;
  let taskless: string;

  async function seedVersion(version: number): Promise<void> {
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version, install: {} }),
      "utf8"
    );
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-rule-no-migrate-"));
    taskless = join(directory, ".taskless");
    await mkdir(join(taskless, "rules"), { recursive: true });
    await seedVersion(3);
    await writeFile(join(taskless, "rules", "no-eval.yml"), FLAT_RULE, "utf8");
    await writeFile(
      join(directory, "request.json"),
      JSON.stringify({ prompt: "no eval" }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(Object.keys(COMMANDS))(
    "rule %s refuses a behind scaffold and leaves the tree as it was",
    async (name) => {
      const { stdout, exitCode } = await runCli([
        ...COMMANDS[name]!,
        "--json",
        "-d",
        directory,
      ]);
      expect(exitCode).toBe(1);
      const envelope = JSON.parse(stdout.trim()) as {
        ok?: boolean;
        code?: string;
        message?: string;
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe("SCAFFOLD_MIGRATION_REQUIRED");
      expect(envelope.message).toMatch(/init/);

      const manifest = JSON.parse(
        await readFile(join(taskless, "taskless.json"), "utf8")
      ) as { version: number };
      expect(manifest.version).toBe(3);
      await expect(
        stat(join(taskless, "rules", "no-eval.yml"))
      ).resolves.toBeDefined();
      await expect(stat(join(taskless, "rules", "sg"))).rejects.toThrow();
    }
  );

  it.each(Object.keys(COMMANDS))(
    "rule %s refuses a scaffold newer than the CLI",
    async (name) => {
      await seedVersion(99);
      const { stdout, stderr, exitCode } = await runCli([
        ...COMMANDS[name]!,
        "-d",
        directory,
      ]);
      expect(exitCode).toBe(1);
      expect(`${stdout}${stderr}`).toMatch(/Upgrade the CLI/);
    }
  );
});
