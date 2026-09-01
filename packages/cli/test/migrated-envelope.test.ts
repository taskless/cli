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

interface MigratedField {
  from: number;
  to: number;
  applied: number[];
  files: { added: string[]; modified: string[]; removed: string[] };
}

/** Run the built CLI, tolerating a non-zero exit. */
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    return { stdout: execError.stdout ?? "", stderr: execError.stderr ?? "" };
  }
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as Record<string, unknown>;
}

/** The versions a project seeded at 3 must be carried through. */
const SEEDED_FROM = 3;
const EXPECTED_APPLIED = Array.from(
  { length: LATEST_SCHEMA_VERSION - SEEDED_FROM },
  (_, index) => SEEDED_FROM + index + 1
);

/** Assert the field describes the seeded project's migration to the latest. */
function expectSeededMigration(migrated: unknown): void {
  const field = migrated as MigratedField;
  expect(field.from).toBe(SEEDED_FROM);
  expect(field.to).toBe(LATEST_SCHEMA_VERSION);
  // Every intervening version, derived. Listed literally this said `[4, 5]`,
  // so adding a migration made the assertion wrong rather than making it cover
  // the new one.
  expect(field.applied).toEqual(EXPECTED_APPLIED);
  // The rule's new home, its old home, and the manifest that records the
  // version: the three facts that turn an unexplained diff into an explained
  // one.
  expect(field.files.added).toContain(".taskless/rules/sg/no-eval/no-eval.yml");
  expect(field.files.removed).toContain(".taskless/rules/no-eval.yml");
  expect(field.files.removed).toContain(".taskless/sgconfig.yml");
  expect(field.files.modified).toContain(".taskless/taskless.json");
}

describe("who migrates, and who refuses", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-migrated-"));
    tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  /** A version-3 scaffold: one flat ast-grep rule and its committed config. */
  async function seedVersion3(): Promise<void> {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3, install: {} }),
      "utf8"
    );
    await writeFile(
      join(tasklessDirectory, "sgconfig.yml"),
      "ruleDirs:\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n",
      "utf8"
    );
    await mkdir(join(tasklessDirectory, "rules"), { recursive: true });
    await writeFile(
      join(tasklessDirectory, "rules", "no-eval.yml"),
      "id: no-eval\nlanguage: TypeScript\nseverity: error\nmessage: no eval\nrule:\n  pattern: eval($A)\n",
      "utf8"
    );
  }

  it("init --json reports the migration it performed", async () => {
    // `init` is the only command that migrates now, so it is the only one that
    // can report one. The field moved with the behaviour rather than being
    // dropped: a CI script still needs to know the working tree was rewritten
    // and what moved.
    await seedVersion3();

    const { stdout } = await runCli([
      "init",
      "--no-interactive",
      "--json",
      "-d",
      temporaryDirectory,
    ]);

    const envelope = parseEnvelope(stdout);
    expect(envelope.migrated).toBeDefined();
    expectSeededMigration(envelope.migrated);
  });

  it("init --json omits the field when nothing migrated", async () => {
    // Absence is the signal, so a consumer never reads empty arrays to decide.
    await seedVersion3();
    await runCli(["init", "--no-interactive", "-d", temporaryDirectory]);

    const { stdout } = await runCli([
      "init",
      "--no-interactive",
      "--json",
      "-d",
      temporaryDirectory,
    ]);

    expect(parseEnvelope(stdout)).not.toHaveProperty("migrated");
  });

  it.each(["check", "verify", "test"] as const)(
    "%s refuses a project behind the CLI rather than migrating it",
    async (command) => {
      // The behaviour this file used to assert, inverted. These commands
      // report; migrating as a side effect meant a read rewrote the
      // repository, and it made a migration unverifiable, since asking the
      // question performed the change.
      await seedVersion3();

      const { stdout, stderr } = await runCli([
        command,
        "--json",
        "-d",
        temporaryDirectory,
      ]);

      const output = `${stdout}${stderr}`;
      expect(output).toContain("SCAFFOLD_MIGRATION_REQUIRED");
      expect(output).toMatch(/init/);

      // And it left the project alone: still version 3, rule still flat.
      const manifest = JSON.parse(
        await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
      ) as { version: number };
      expect(manifest.version).toBe(SEEDED_FROM);
      await expect(
        stat(join(tasklessDirectory, "rules", "no-eval.yml"))
      ).resolves.toBeDefined();
    }
  );

  it("names the versions and the files on human stderr", async () => {
    await seedVersion3();

    const { stderr } = await runCli([
      "init",
      "--no-interactive",
      "-d",
      temporaryDirectory,
    ]);

    const span = `from schema version ${String(SEEDED_FROM)} to ${String(LATEST_SCHEMA_VERSION)}`;
    expect(stderr).toContain(`Migrating .taskless/ ${span}`);
    expect(stderr).toContain(`Migrated .taskless/ ${span}:`);
    expect(stderr).toContain("+ .taskless/rules/sg/no-eval/no-eval.yml");
    expect(stderr).toContain("- .taskless/sgconfig.yml");
  });

  it("says nothing on stderr when the scaffold is already current", async () => {
    await seedVersion3();
    await runCli(["init", "--no-interactive", "-d", temporaryDirectory]);

    const { stderr } = await runCli([
      "init",
      "--no-interactive",
      "-d",
      temporaryDirectory,
    ]);

    expect(stderr).not.toContain("Migrat");
  });
});
