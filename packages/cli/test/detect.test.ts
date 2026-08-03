import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
}

async function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      // Keep detect hermetic: telemetry is best-effort and would otherwise
      // write an anonymous-id file and attempt network I/O on shutdown, which
      // must never be part of detect's offline scan path.
      env: {
        ...process.env,
        DO_NOT_TRACK: "1",
        TASKLESS_TELEMETRY_DISABLED: "1",
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const error_ = error as ExecError;
    return {
      stdout: error_.stdout ?? "",
      stderr: error_.stderr ?? "",
      exitCode: error_.code ?? 1,
    };
  }
}

interface DetectJson {
  success: boolean;
  linters: { name: string; evidence: string[] }[];
  languages: string[];
  ruleStyles: { source: string; description: string }[];
}

async function detect(cwd: string): Promise<DetectJson> {
  const { stdout, exitCode } = await runCli(
    ["detect", "--json", "-d", cwd],
    cwd
  );
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as DetectJson;
}

function linterNames(result: DetectJson): string[] {
  return result.linters.map((l) => l.name);
}

describe("taskless detect", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-detect-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("detects eslint from a config file", async () => {
    await writeFile(join(cwd, ".eslintrc.json"), "{}", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("eslint");
  });

  it("detects ruff from a pyproject [tool.ruff] table", async () => {
    await writeFile(
      join(cwd, "pyproject.toml"),
      "[tool.ruff]\nline-length = 88\n",
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("ruff");
    expect(result.languages).toContain("Python");
  });

  it("detects rubocop from .rubocop.yml", async () => {
    await writeFile(join(cwd, ".rubocop.yml"), "", "utf8");
    await writeFile(join(cwd, "Gemfile"), "", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("rubocop");
    expect(result.languages).toContain("Ruby");
  });

  it("detects golangci-lint for a Go repo", async () => {
    await writeFile(join(cwd, "go.mod"), "module example.com/x\n", "utf8");
    await writeFile(join(cwd, ".golangci.yml"), "", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("golangci-lint");
    expect(result.languages).toContain("Go");
  });

  it("detects phpstan for a PHP repo", async () => {
    await writeFile(join(cwd, "composer.json"), "{}", "utf8");
    await writeFile(join(cwd, "phpstan.neon"), "", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("phpstan");
    expect(result.languages).toContain("PHP");
  });

  it("detects clippy for a Rust repo", async () => {
    await writeFile(join(cwd, "Cargo.toml"), '[package]\nname = "x"\n', "utf8");
    await writeFile(join(cwd, "clippy.toml"), "", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("clippy");
    expect(result.languages).toContain("Rust");
  });

  it("detects biome from biome.json", async () => {
    await writeFile(join(cwd, "biome.json"), "{}", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("biome");
  });

  it("detects stylelint from a package.json devDependency", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { stylelint: "^16.0.0" } }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("stylelint");
  });

  it("infers languages from package.json", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18", next: "^14" },
        devDependencies: { typescript: "^5" },
      }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(result.languages).toEqual(
      expect.arrayContaining(["JavaScript", "TypeScript"])
    );
  });

  it("detects ruff from a pyproject [project] dependency", async () => {
    await writeFile(
      join(cwd, "pyproject.toml"),
      '[project]\nname = "x"\ndependencies = ["ruff>=0.4", "requests"]\n',
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("ruff");
    expect(result.languages).toContain("Python");
  });

  it("detects flake8 from a requirements.txt entry", async () => {
    await writeFile(
      join(cwd, "requirements.txt"),
      "# linting\nflake8==7.0.0\nrequests>=2\n",
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("flake8");
    expect(result.languages).toContain("Python");
  });

  it("does not look up a Python linter dependency in package.json", async () => {
    // A node manifest naming `ruff` must not register the Python linter — deps
    // are sourced from the language's own manifest, never conflated.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { ruff: "^1.0.0" } }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).not.toContain("ruff");
  });

  it("degrades gracefully on a malformed pyproject.toml", async () => {
    // A TOML parse failure drops only the pyproject-derived signal; the file's
    // presence still marks Python and a config file is an independent tell.
    await writeFile(
      join(cwd, "pyproject.toml"),
      "this is = = not valid toml [[[\n",
      "utf8"
    );
    await writeFile(join(cwd, "ruff.toml"), "line-length = 88\n", "utf8");
    const result = await detect(cwd);
    expect(result.success).toBe(true);
    expect(result.languages).toContain("Python");
    expect(linterNames(result)).toContain("ruff");
  });

  it("detects a linter configured in a sub-package (monorepo)", async () => {
    await mkdir(join(cwd, "packages", "api"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "api", ".eslintrc.json"),
      "{}",
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("eslint");
    const eslint = result.linters.find((l) => l.name === "eslint");
    expect(eslint?.evidence).toContain("packages/api/.eslintrc.json");
  });

  it("ignores linter configs inside node_modules", async () => {
    await mkdir(join(cwd, "node_modules", "some-dep"), { recursive: true });
    await writeFile(
      join(cwd, "node_modules", "some-dep", ".eslintrc.json"),
      "{}",
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).not.toContain("eslint");
  });

  it("surfaces the repo's own Taskless rule styles", async () => {
    await mkdir(join(cwd, ".taskless", "sg", "rules"), { recursive: true });
    const result = await detect(cwd);
    expect(
      result.ruleStyles.some((s) => s.source === ".taskless/sg/rules")
    ).toBe(true);
  });

  it("emits a stable JSON shape with only signal keys (no packaged-rule claims)", async () => {
    await writeFile(join(cwd, ".eslintrc.json"), "{}", "utf8");
    const result = await detect(cwd);
    expect(Object.keys(result).toSorted()).toEqual(
      ["languages", "linters", "ruleStyles", "success"].toSorted()
    );
    // A linter entry exposes only name + evidence, never a rule-name claim.
    for (const linter of result.linters) {
      expect(Object.keys(linter).toSorted()).toEqual(
        ["evidence", "name"].toSorted()
      );
    }
  });

  it("does not false-positive a pyproject table on a similarly-prefixed sibling", async () => {
    // `[tool.ruff-lsp]` must NOT be read as the `ruff` tool table.
    await writeFile(
      join(cwd, "pyproject.toml"),
      "[tool.ruff-lsp]\nfoo = 1\n",
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).not.toContain("ruff");
  });

  it("detects ruff from a nested pyproject table ([tool.ruff.lint])", async () => {
    await writeFile(
      join(cwd, "pyproject.toml"),
      '[tool.ruff.lint]\nselect = ["E"]\n',
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("ruff");
  });

  it("ignores a malformed package.json dependency field without crashing", async () => {
    // `dependencies` as an array (not an object) must not yield bogus deps.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: ["eslint"], devDependencies: null }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(result.success).toBe(true);
    // The array form yields no dependency names, so no dep-based linter.
    expect(linterNames(result)).not.toContain("eslint");
  });

  it("runs successfully with no linters, no network, and no auth", async () => {
    const result = await detect(cwd);
    expect(result.success).toBe(true);
    expect(result.linters).toEqual([]);
  });
});
