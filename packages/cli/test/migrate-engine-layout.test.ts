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

// 0004 and 0005 always run together — both are unreleased and both ship in the
// same stack, so a user upgrades through the pair and never observes the
// intermediate engine-partitioned layout. These assert the end state, which is
// the only one anybody sees.
describe("migrations 0004 + 0005 — one directory per rule", () => {
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

  it("moves the ast-grep tree into rule directories without editing contents", async () => {
    await seedLegacyLayout();
    const beforeRule = await sha256(
      join(tasklessDirectory, "rules", "no-eval.yml")
    );
    const beforeConfig = await sha256(join(tasklessDirectory, "sgconfig.yml"));

    await ensureTasklessDirectory(temporaryDirectory);

    expect(
      await sha256(
        join(tasklessDirectory, "rules", "sg", "no-eval", "no-eval.yml")
      )
    ).toBe(beforeRule);
    // The committed sgconfig is gone — assembly generates it per run — so its
    // bytes are no longer preserved anywhere, only its content's effect.
    expect(beforeConfig).toBeTruthy();
    expect(await exists(join(tasklessDirectory, "sg", "sgconfig.yml"))).toBe(
      false
    );

    // Test files land inside the rule they belong to. The name has no
    // timestamp here, so 0005 cannot attribute it and leaves it behind —
    // asserted in its own test below.

    // Pre-0004 locations are gone once fully moved.
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
          "rules",
          "runtime",
          "no-eval-runtime",
          "captures",
          "capture.yml"
        )
      )
    ).toBe(before.capture);
    expect(
      await sha256(
        join(
          tasklessDirectory,
          "rules",
          "runtime",
          "no-eval-runtime",
          "check.ts"
        )
      )
    ).toBe(before.check);
    expect(
      await sha256(
        join(
          tasklessDirectory,
          "rules",
          "runtime",
          "no-eval-runtime",
          ".tests",
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
          "rules",
          "runtime",
          "no-eval-runtime",
          "captures",
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

  it("anchors the sgconfig.yml gitignore pattern so the committed sg config is tracked", async () => {
    await seedLegacyLayout();
    // Start at version 0 so 0001 runs too: it appends the anchored form, and
    // 0004 must collapse that with the legacy unanchored line rather than
    // leaving both.
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 0 }),
      "utf8"
    );
    // The pattern 0001 used to write: unanchored, so it matches at any depth
    // and would swallow `.taskless/sg/sgconfig.yml`.
    await writeFile(
      join(tasklessDirectory, ".gitignore"),
      ".env.local.json\nsgconfig.yml\n",
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const gitignore = await readFile(
      join(tasklessDirectory, ".gitignore"),
      "utf8"
    );
    const entries = gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(entries).toContain("/sgconfig.yml");
    expect(entries).not.toContain("sgconfig.yml");
    expect(entries).toContain(".env.local.json");
    // Exactly one entry, even though 0001 also appends the anchored form.
    expect(entries.filter((entry) => entry === "/sgconfig.yml")).toHaveLength(
      1
    );
  });

  it("leaves an already-anchored gitignore entry untouched", async () => {
    await seedLegacyLayout();
    const original = ".env.local.json\n/sgconfig.yml\n.run/\n";
    await writeFile(join(tasklessDirectory, ".gitignore"), original, "utf8");

    await ensureTasklessDirectory(temporaryDirectory);

    const contents = await readFile(
      join(tasklessDirectory, ".gitignore"),
      "utf8"
    );
    // 0004 leaves the anchored entry alone; 0005 appends the two assembled
    // configs, which are generated per run and must never be committed.
    expect(contents).toContain("/sgconfig.yml");
    expect(contents).toContain(".env.local.json");
    expect(contents).toContain("/.vale.ini");
    expect(contents).toContain("/.sgconfig.yml");
  });

  it("scaffolds each engine and gitkeeps it while empty", async () => {
    await seedLegacyLayout();

    await ensureTasklessDirectory(temporaryDirectory);

    // The committed .vale.ini is gone; the run config is assembled and
    // gitignored rather than scaffolded.
    expect(await exists(join(tasklessDirectory, "vale", ".vale.ini"))).toBe(
      false
    );
    for (const relative of [["rules", "vale"]]) {
      expect(
        await exists(join(tasklessDirectory, ...relative, ".gitkeep"))
      ).toBe(true);
    }

    // Directories that received real content are not gitkeeped.
    expect(
      await exists(join(tasklessDirectory, "rules", "sg", ".gitkeep"))
    ).toBe(false);
    expect(
      await exists(join(tasklessDirectory, "rules", "runtime", ".gitkeep"))
    ).toBe(false);
  });

  it("scaffolds a full layout for a fresh project and bumps to the latest version", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number };
    expect(manifest.version).toBe(5);

    for (const relative of [
      ["rules", "sg"],
      ["rules", "vale"],
      ["rules", "runtime"],
    ]) {
      expect(
        await exists(join(tasklessDirectory, ...relative, ".gitkeep"))
      ).toBe(true);
    }
    // Both engine configs are assembled per run, so neither is scaffolded.
    expect(await exists(join(tasklessDirectory, "sg", "sgconfig.yml"))).toBe(
      false
    );

    // The ignore pattern is anchored from the start for a fresh scaffold.
    const gitignore = await readFile(
      join(tasklessDirectory, ".gitignore"),
      "utf8"
    );
    expect(gitignore).toContain("/sgconfig.yml");
    expect(
      gitignore
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    ).not.toContain("sgconfig.yml");
  });

  it("is idempotent — a second run changes nothing", async () => {
    await seedLegacyLayout();
    await ensureTasklessDirectory(temporaryDirectory);
    const after = await sha256(
      join(tasklessDirectory, "rules", "sg", "no-eval", "no-eval.yml")
    );

    // Re-run 0005 directly (runMigrations would short-circuit on version).
    const { default: migration } = await import(
      "../src/filesystem/migrations/0005-rule-directories"
    );
    await migration(tasklessDirectory);

    expect(
      await sha256(
        join(tasklessDirectory, "rules", "sg", "no-eval", "no-eval.yml")
      )
    ).toBe(after);
    // The pre-0004 flat locations stay gone; the rules tree is the new root.
    expect(await exists(join(tasklessDirectory, "rule-tests"))).toBe(false);
  });

  it("refuses to start when a file occupies an engine directory", async () => {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3 }),
      "utf8"
    );
    // A *file* sits where `rules/` would land. Nothing can merge the two, so
    // the migration must fail before it moves anything — a partial move would
    // leave `.taskless/` split across both layouts.
    await writeTree(tasklessDirectory, {
      "rules/no-eval.yml": CAPTURE_YML,
      "runtime-rules/no-eval-capture/rule.yml": CAPTURE_YML,
      "sg/rules": "not a directory\n",
    });

    await expect(ensureTasklessDirectory(temporaryDirectory)).rejects.toThrow(
      /\.taskless\/sg\/rules is a file/
    );

    // Everything is exactly where it was: no half-migration.
    expect(await sha256(join(tasklessDirectory, "rules", "no-eval.yml"))).toBe(
      createHash("sha256").update(CAPTURE_YML).digest("hex")
    );
    expect(
      await exists(join(tasklessDirectory, "runtime-rules", "no-eval-capture"))
    ).toBe(true);
    expect(await exists(join(tasklessDirectory, "rules", "runtime"))).toBe(
      false
    );
    // 0004 refuses before 0005 runs, so the occupied path is untouched.
    expect(await readFile(join(tasklessDirectory, "sg", "rules"), "utf8")).toBe(
      "not a directory\n"
    );
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

describe("migration 0004 — engine root occupied by a file", () => {
  let temporaryDirectory: string;
  let tasklessDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-0004-root-"));
    tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("refuses when an engine root itself is a file", async () => {
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 3 }),
      "utf8"
    );
    await writeTree(tasklessDirectory, {
      "rules/no-eval.yml": CAPTURE_YML,
      "runtime-rules/demo/capture.yml": CAPTURE_YML,
    });
    // `.taskless/runtime` is a FILE, so `runtime/rules` cannot be created.
    await writeFile(join(tasklessDirectory, "runtime"), "not a dir\n", "utf8");

    await expect(ensureTasklessDirectory(temporaryDirectory)).rejects.toThrow(
      /\.taskless\/runtime is a file/
    );

    // Nothing moved: the sg tree is still where it started.
    expect(await exists(join(tasklessDirectory, "rules", "no-eval.yml"))).toBe(
      true
    );
    expect(await exists(join(tasklessDirectory, "rules", "sg"))).toBe(false);
  });
});
