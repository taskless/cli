import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("the migrated field on the --json envelope", () => {
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

  for (const command of ["check", "verify", "test"] as const) {
    it(`${command} --json reports the migration it performed`, async () => {
      await seedVersion3();

      const { stdout } = await runCli([
        command,
        "--json",
        "-d",
        temporaryDirectory,
      ]);

      const envelope = parseEnvelope(stdout);
      expect(envelope.migrated).toBeDefined();
      expectSeededMigration(envelope.migrated);
    });

    it(`${command} --json omits the field when nothing migrated`, async () => {
      await seedVersion3();
      // First run migrates; the second finds the scaffold current. Absence is
      // the signal, so a consumer never has to read empty arrays to decide.
      await runCli([command, "--json", "-d", temporaryDirectory]);

      const { stdout } = await runCli([
        command,
        "--json",
        "-d",
        temporaryDirectory,
      ]);

      const envelope = parseEnvelope(stdout);
      expect(envelope).not.toHaveProperty("migrated");
    });
  }

  it("names the versions and the files on human stderr", async () => {
    await seedVersion3();

    const { stderr } = await runCli(["check", "-d", temporaryDirectory]);

    const span = `from schema version ${String(SEEDED_FROM)} to ${String(LATEST_SCHEMA_VERSION)}`;
    expect(stderr).toContain(`Migrating .taskless/ ${span}`);
    expect(stderr).toContain(`Migrated .taskless/ ${span}:`);
    expect(stderr).toContain("+ .taskless/rules/sg/no-eval/no-eval.yml");
    expect(stderr).toContain("- .taskless/sgconfig.yml");
  });

  it("says nothing on stderr when the scaffold is already current", async () => {
    await seedVersion3();
    await runCli(["check", "-d", temporaryDirectory]);

    const { stderr } = await runCli(["check", "-d", temporaryDirectory]);

    expect(stderr).not.toContain("Migrat");
  });
});
