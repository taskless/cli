import { createHash } from "node:crypto";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { runMigrations } from "../src/filesystem/migrate";
import { CLIError } from "../src/util/cli-error";

/** Bytes of a runtime capture rule; its hash must survive the move. */
const CAPTURE_YML = `id: no-eval-capture\nlanguage: typescript\nrule:\n  pattern: eval($$$ARGS)\n`;
const CHECK_TS = `export function check() {\n  return { ok: true };\n}\n`;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function writeTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

describe("migration 0004 — engine-partitioned layout", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-0004-"));
    tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  /** Seed a pre-0004 `.taskless/` at version 3 with rules and a runtime tier. */
  async function seedLegacyLayout(): Promise<void> {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3, install: {} }),
      "utf8"
    );
    await writeTree(tasklessDirectory, {
      "sgconfig.yml":
        "ruleDirs:\n  - rules\ntestConfigs:\n  - testDir: rule-tests\n",
      "rules/no-eval.yml":
        "id: no-eval\nlanguage: typescript\nrule:\n  pattern: eval($A)\n",
      "rule-tests/no-eval-test.yml": "id: no-eval\nvalid:\n  - foo()\n",
      "runtime-rules/no-eval-runtime/capture.yml": CAPTURE_YML,
      "runtime-rules/no-eval-runtime/check.ts": CHECK_TS,
      "runtime-rule-tests/no-eval-runtime/fixture-a/input.ts": "eval('x');\n",
    });
  }

  it("moves the ast-grep tree under sg/ without editing contents", async () => {
    await seedLegacyLayout();
    const beforeRule = await sha256(
      join(tasklessDirectory, "rules", "no-eval.yml")
    );
    const beforeConfig = await sha256(join(tasklessDirectory, "sgconfig.yml"));

    await ensureTasklessDirectory(temporaryDirectory);

    expect(
      await sha256(join(tasklessDirectory, "sg", "rules", "no-eval.yml"))
    ).toBe(beforeRule);
    expect(await sha256(join(tasklessDirectory, "sg", "sgconfig.yml"))).toBe(
      beforeConfig
    );
    expect(
      await exists(
        join(tasklessDirectory, "sg", "rule-tests", "no-eval-test.yml")
      )
    ).toBe(true);

    // Legacy locations are gone once fully moved.
    expect(await exists(join(tasklessDirectory, "rules"))).toBe(false);
    expect(await exists(join(tasklessDirectory, "rule-tests"))).toBe(false);
    expect(await exists(join(tasklessDirectory, "sgconfig.yml"))).toBe(false);
  });

  it("moves the runtime tier byte-for-byte", async () => {
    await seedLegacyLayout();
    const before = {
      capture: await sha256(
        join(
          tasklessDirectory,
          "runtime-rules",
          "no-eval-runtime",
          "capture.yml"
        )
      ),
      check: await sha256(
        join(tasklessDirectory, "runtime-rules", "no-eval-runtime", "check.ts")
      ),
      fixture: await sha256(
        join(
          tasklessDirectory,
          "runtime-rule-tests",
          "no-eval-runtime",
          "fixture-a",
          "input.ts"
        )
      ),
    };

    await ensureTasklessDirectory(temporaryDirectory);

    expect(
      await sha256(
        join(
          tasklessDirectory,
          "runtime",
          "rules",
          "no-eval-runtime",
          "capture.yml"
        )
      )
    ).toBe(before.capture);
    expect(
      await sha256(
        join(
          tasklessDirectory,
          "runtime",
          "rules",
          "no-eval-runtime",
          "check.ts"
        )
      )
    ).toBe(before.check);
    expect(
      await sha256(
        join(
          tasklessDirectory,
          "runtime",
          "rule-tests",
          "no-eval-runtime",
          "fixture-a",
          "input.ts"
        )
      )
    ).toBe(before.fixture);

    // Contents, not just hashes: the capture bytes are what the server signs.
    expect(
      await readFile(
        join(
          tasklessDirectory,
          "runtime",
          "rules",
          "no-eval-runtime",
          "capture.yml"
        ),
        "utf8"
      )
    ).toBe(CAPTURE_YML);

    expect(await exists(join(tasklessDirectory, "runtime-rules"))).toBe(false);
    expect(await exists(join(tasklessDirectory, "runtime-rule-tests"))).toBe(
      false
    );
  });

  it("scaffolds vale/ and gitkeeps every otherwise-empty directory", async () => {
    await seedLegacyLayout();

    await ensureTasklessDirectory(temporaryDirectory);

    expect(await exists(join(tasklessDirectory, "vale", ".vale.ini"))).toBe(
      true
    );
    for (const relative of [
      ["vale", "rules"],
      ["vale", "rule-tests"],
    ]) {
      expect(
        await exists(join(tasklessDirectory, ...relative, ".gitkeep"))
      ).toBe(true);
    }

    // Directories that received real content are not gitkeeped.
    expect(
      await exists(join(tasklessDirectory, "sg", "rules", ".gitkeep"))
    ).toBe(false);
    expect(
      await exists(join(tasklessDirectory, "runtime", "rules", ".gitkeep"))
    ).toBe(false);
  });

  it("scaffolds a full layout for a fresh project and bumps the version to 4", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(4);

    for (const relative of [
      ["sg", "rules"],
      ["sg", "rule-tests"],
      ["vale", "rules"],
      ["vale", "rule-tests"],
      ["runtime", "rules"],
      ["runtime", "rule-tests"],
    ]) {
      expect(
        await exists(join(tasklessDirectory, ...relative, ".gitkeep"))
      ).toBe(true);
    }
    expect(await exists(join(tasklessDirectory, "sg", "sgconfig.yml"))).toBe(
      true
    );
  });

  it("is idempotent — a second run changes nothing", async () => {
    await seedLegacyLayout();
    await ensureTasklessDirectory(temporaryDirectory);
    const after = await sha256(
      join(tasklessDirectory, "sg", "rules", "no-eval.yml")
    );

    // Re-run the migration directly (runMigrations would short-circuit on version).
    const { default: migration } =
      await import("../src/filesystem/migrations/0004-vale-engine");
    await migration(tasklessDirectory);

    expect(
      await sha256(join(tasklessDirectory, "sg", "rules", "no-eval.yml"))
    ).toBe(after);
    expect(await exists(join(tasklessDirectory, "rules"))).toBe(false);
  });

  it("preserves an existing sg/sgconfig.yml rather than overwriting it", async () => {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3 }),
      "utf8"
    );
    const custom = "ruleDirs:\n  - rules\n# hand-edited\n";
    await writeTree(tasklessDirectory, { "sg/sgconfig.yml": custom });

    await ensureTasklessDirectory(temporaryDirectory);

    expect(
      await readFile(join(tasklessDirectory, "sg", "sgconfig.yml"), "utf8")
    ).toBe(custom);
  });
});

describe("scaffold version gating", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "taskless-version-gate-")
    );
    tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function seedFutureManifest(): Promise<void> {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 99 }),
      "utf8"
    );
  }

  it("throws when the scaffold is newer than the CLI knows", async () => {
    await seedFutureManifest();

    await expect(runMigrations(tasklessDirectory)).rejects.toThrow(CLIError);
    await expect(runMigrations(tasklessDirectory)).rejects.toThrow(
      /Upgrade the CLI/i
    );
  });

  it("proceeds without migrating when the override is set", async () => {
    await seedFutureManifest();

    await expect(
      runMigrations(tasklessDirectory, { allowVersionMismatches: true })
    ).resolves.toBeUndefined();

    // Nothing was migrated and the version was left alone.
    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(99);
    expect(await exists(join(tasklessDirectory, "sg"))).toBe(false);
  });

  it("honours --allow-version-mismatches from argv", async () => {
    await seedFutureManifest();
    const originalArgv = process.argv;
    process.argv = [
      ...originalArgv.slice(0, 2),
      "check",
      "--allow-version-mismatches",
    ];
    try {
      await expect(
        ensureTasklessDirectory(temporaryDirectory)
      ).resolves.toBeUndefined();
    } finally {
      process.argv = originalArgv;
    }
  });

  it("does not throw when the scaffold matches the CLI's max version", async () => {
    await ensureTasklessDirectory(temporaryDirectory);
    await expect(
      ensureTasklessDirectory(temporaryDirectory)
    ).resolves.toBeUndefined();
  });
});
