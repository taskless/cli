import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import fixtureCaseDirectories from "../src/filesystem/migrations/0012-fixture-case-directories";

/**
 * Migration 12: every rule's fixtures move from `.tests/` into
 * `tests/pass/<case>/` and `tests/fail/<case>/`. The scenarios are the ones
 * `cli-taskless-bootstrap` states for it, plus the two safety rails the
 * migration documents beyond them.
 */

let cwd: string;
let tasklessDirectory: string;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-0012-"));
  tasklessDirectory = join(cwd, ".taskless");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  errorSpy.mockRestore();
  await rm(cwd, { recursive: true, force: true });
});

async function writeTree(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(tasklessDirectory, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

/** Every file under `.taskless/`, as relative path → bytes. */
async function snapshot(): Promise<Record<string, string>> {
  const entries = await readdir(tasklessDirectory, {
    recursive: true,
    withFileTypes: true,
  });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(tasklessDirectory, path)] = await readFile(path, "utf8");
  }
  return files;
}

async function readVersion(): Promise<number> {
  const manifest = JSON.parse(
    await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
  ) as { version: number };
  return manifest.version;
}

/**
 * A project scaffolded by this CLI and then set back to version 11, so the
 * next `ensureTasklessDirectory` runs migration 12 and nothing else.
 */
async function scaffoldAtVersion11(): Promise<void> {
  await ensureTasklessDirectory(cwd, { onNotice: () => {} });
  const path = join(tasklessDirectory, "taskless.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  manifest.version = 11;
  await writeFile(path, JSON.stringify(manifest, undefined, 2), "utf8");
}

const sgRule = (id: string, extra = "") =>
  `id: ${id}\nlanguage: TypeScript\nseverity: error\nmessage: m\nrule:\n  pattern: eval($A)\n${extra}`;

/** The one notice migration 12 prints, or "" when it printed none. */
function notice(): string {
  return errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("migration 12: fixtures into case directories", () => {
  it("turns ast-grep snippets into case directories and records version 12", async () => {
    await scaffoldAtVersion11();
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/no-eval-test.yml":
        "id: no-eval\nvalid:\n  - JSON.parse(x)\n  - const a = 1;\ninvalid:\n  - eval(x)\n",
    });

    const report = await ensureTasklessDirectory(cwd, { onNotice: () => {} });

    expect(report?.applied).toEqual([12]);
    expect(await readVersion()).toBe(12);
    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    expect(await readdir(join(rule, "tests", "pass"))).toEqual([
      "pass-01",
      "pass-02",
    ]);
    expect(await readdir(join(rule, "tests", "fail"))).toEqual(["fail-01"]);
    await expect(
      readFile(join(rule, "tests/pass/pass-01/pass-01.ts"), "utf8")
    ).resolves.toBe("JSON.parse(x)\n");
    await expect(
      readFile(join(rule, "tests/pass/pass-02/pass-02.ts"), "utf8")
    ).resolves.toBe("const a = 1;\n");
    await expect(
      readFile(join(rule, "tests/fail/fail-01/fail-01.ts"), "utf8")
    ).resolves.toBe("eval(x)\n");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
    expect(notice()).toBe("");
  });

  it("puts a scoped rule's case where its files: glob looks", async () => {
    await writeTree({
      "rules/sg/pin-actions/pin-actions.yml": `id: pin-actions\nlanguage: Yaml\nseverity: error\nmessage: m\nfiles:\n  - ".github/workflows/*.yml"\nrule:\n  pattern: "uses: $A"\n`,
      "rules/sg/pin-actions/.tests/pin-actions-test.yml":
        "id: pin-actions\ninvalid:\n  - |\n    steps:\n      - uses: actions/checkout@v4\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const fixture = join(
      tasklessDirectory,
      "rules/sg/pin-actions/tests/fail/fail-01/.github/workflows/fail-01.yml"
    );
    await expect(readFile(fixture, "utf8")).resolves.toBe(
      "steps:\n  - uses: actions/checkout@v4\n"
    );
  });

  it("leaves what it cannot convert, names it, and still migrates the rest", async () => {
    const stuck = "id: stuck\ninvalid:\n  - eval(x)\n";
    await writeTree({
      // Every path `files:` admits, `ignores:` excludes.
      "rules/sg/stuck/stuck.yml": sgRule(
        "stuck",
        'files:\n  - "src/**/*.ts"\nignores:\n  - "src/**"\n'
      ),
      "rules/sg/stuck/.tests/stuck-test.yml": stuck,
      "rules/sg/fine/fine.yml": sgRule("fine"),
      "rules/sg/fine/.tests/fine-test.yml": "id: fine\ninvalid:\n  - eval(x)\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rules = join(tasklessDirectory, "rules", "sg");
    await expect(
      readFile(join(rules, "stuck", ".tests", "stuck-test.yml"), "utf8")
    ).resolves.toBe(stuck);
    expect(existsSync(join(rules, "stuck", "tests"))).toBe(false);
    expect(notice()).toContain("stuck: stuck-test.yml");
    expect(notice()).toContain("no path could be derived");

    expect(
      existsSync(join(rules, "fine", "tests/fail/fail-01/fail-01.ts"))
    ).toBe(true);
    expect(existsSync(join(rules, "fine", ".tests"))).toBe(false);
  });

  it("leaves a test file whose id: names another rule, and names it", async () => {
    // ast-grep ran a test file for the rule its `id:` names, so this one never
    // exercised the rule it sits beside. Converting it would invent a test.
    const foreign = "id: someone-else\ninvalid:\n  - eval(x)\n";
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/foreign-test.yml": foreign,
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    await expect(
      readFile(join(rule, ".tests", "foreign-test.yml"), "utf8")
    ).resolves.toBe(foreign);
    expect(existsSync(join(rule, "tests"))).toBe(false);
    expect(notice()).toContain("foreign-test.yml");
    expect(notice()).toContain('"someone-else"');
  });

  it("keeps every snippet of a rule with two dated test files", async () => {
    // Migration 5 files each authoring round's `<id>-YYYYMMDD-test.yml` beside
    // the others, so a rule improved twice arrives here with two. Numbering
    // each from one put both `invalid:` snippets at fail-01, kept the first,
    // and deleted the second file.
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/no-eval-20260101-test.yml":
        "id: no-eval\ninvalid:\n  - eval(a)\n",
      "rules/sg/no-eval/.tests/no-eval-20260301-test.yml":
        "id: no-eval\nvalid:\n  - ok()\ninvalid:\n  - eval(b)\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    await expect(
      readFile(join(rule, "tests/fail/fail-01/fail-01.ts"), "utf8")
    ).resolves.toBe("eval(a)\n");
    await expect(
      readFile(join(rule, "tests/fail/fail-02/fail-02.ts"), "utf8")
    ).resolves.toBe("eval(b)\n");
    await expect(
      readFile(join(rule, "tests/pass/pass-01/pass-01.ts"), "utf8")
    ).resolves.toBe("ok()\n");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
    expect(notice()).toBe("");
  });

  it("numbers past cases already in tests/, for a file fixed after an earlier run", async () => {
    // An earlier run converted the good file to fail-01 and left the broken
    // one. Once its author fixes it, it must not collide with fail-01.
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/tests/fail/fail-01/fail-01.ts": "eval(first)\n",
      "rules/sg/no-eval/.tests/no-eval-20260301-test.yml":
        "id: no-eval\ninvalid:\n  - eval(fixed)\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    await expect(
      readFile(join(rule, "tests/fail/fail-01/fail-01.ts"), "utf8")
    ).resolves.toBe("eval(first)\n");
    await expect(
      readFile(join(rule, "tests/fail/fail-02/fail-02.ts"), "utf8")
    ).resolves.toBe("eval(fixed)\n");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
    expect(notice()).toBe("");
  });

  it("removes sg test snapshots, which are not fixtures", async () => {
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/no-eval-test.yml":
        "id: no-eval\ninvalid:\n  - eval(x)\n",
      "rules/sg/no-eval/.tests/__snapshots__/no-eval-snapshot.yml": "x\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
    expect(notice()).toBe("");
  });

  it("finishes a conversion whose files were written but whose source stayed", async () => {
    // A run interrupted between writing a case and removing its source.
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/no-eval-test.yml":
        "id: no-eval\ninvalid:\n  - eval(x)\n",
      "rules/sg/no-eval/tests/fail/fail-01/fail-01.ts": "eval(x)\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "sg", "no-eval");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
    expect(await readdir(join(rule, "tests", "fail"))).toEqual(["fail-01"]);
    expect(notice()).toBe("");
  });

  it("renames runtime cases only, keeping their bytes", async () => {
    const a = "import { b } from './b';\nconsole.log(b);\n";
    const b = "export const b = process.env.SECRET;\n";
    await writeTree({
      "rules/runtime/env-leak/check.ts": "export default async () => [];\n",
      "rules/runtime/env-leak/.tests/fail/two-files/a.ts": a,
      "rules/runtime/env-leak/.tests/fail/two-files/b.ts": b,
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "runtime", "env-leak");
    await expect(
      readFile(join(rule, "tests/fail/two-files/a.ts"), "utf8")
    ).resolves.toBe(a);
    await expect(
      readFile(join(rule, "tests/fail/two-files/b.ts"), "utf8")
    ).resolves.toBe(b);
    expect(existsSync(join(rule, ".tests"))).toBe(false);
  });

  it("puts a Vale document at a path its matchers admit", async () => {
    await writeTree({
      "rules/vale/hedge/hedge.yml": "extends: existence\n",
      "rules/vale/hedge/.vale.ini":
        "[docs/**/*.md]\ntskl) rule = hedge\nhedge.hedge = YES\n",
      "rules/vale/hedge/.tests/fail/hedges.md": "Perhaps.\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);

    const rule = join(tasklessDirectory, "rules", "vale", "hedge");
    await expect(
      readFile(join(rule, "tests/fail/hedges/docs/hedges.md"), "utf8")
    ).resolves.toBe("Perhaps.\n");
    expect(existsSync(join(rule, ".tests"))).toBe(false);
  });

  it("changes nothing when it runs again", async () => {
    await writeTree({
      "rules/sg/no-eval/no-eval.yml": sgRule("no-eval"),
      "rules/sg/no-eval/.tests/no-eval-test.yml":
        "id: no-eval\nvalid:\n  - ok()\ninvalid:\n  - eval(x)\n",
      "rules/runtime/env-leak/check.ts": "export default async () => [];\n",
      "rules/runtime/env-leak/.tests/pass/case/a.ts": "a\n",
    });

    await fixtureCaseDirectories(tasklessDirectory);
    const first = await snapshot();
    await fixtureCaseDirectories(tasklessDirectory);

    expect(await snapshot()).toEqual(first);
  });

  it("ignores /.sg-rules/ exactly once", async () => {
    // `.sg-rules/` is the rules-only tree `check` hands ast-grep, assembled
    // per run, so it is never committed.
    await writeTree({ ".gitignore": "/sgconfig.yml\n" });
    await fixtureCaseDirectories(tasklessDirectory);
    await fixtureCaseDirectories(tasklessDirectory);

    const gitignore = await readFile(
      join(tasklessDirectory, ".gitignore"),
      "utf8"
    );
    const lines = gitignore.split("\n");
    expect(lines.filter((line) => line.trim() === "/.sg-rules/")).toHaveLength(
      1
    );
  });

  it("runs 1 through 12 on a fresh scaffold", async () => {
    // A fresh project and an old one end in the same state by running every
    // migration in order, which is why the shipped ones were left alone.
    const report = await ensureTasklessDirectory(cwd, { onNotice: () => {} });

    expect(LATEST_SCHEMA_VERSION).toBe(12);
    expect(report?.from).toBe(0);
    expect(report?.applied).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
    expect(await readVersion()).toBe(12);
    await expect(
      readFile(join(tasklessDirectory, ".gitignore"), "utf8")
    ).resolves.toContain("/.sg-rules/");
  });
});
