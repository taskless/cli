import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

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
  linters: {
    name: string;
    evidence: string[];
    customRules?: { count: number | "unknown"; evidence: string[] };
  }[];
  languages: string[];
  ruleStyles: { source: string; description: string }[];
  ci: { name: string; evidence: string[] }[];
  hooks: { name: string; evidence: string[] }[];
  hostTools: {
    name: string;
    present: boolean;
    path?: string;
    applicable: boolean;
    reason?: string;
  }[];
  agent: Record<string, string>;
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

function customRules(result: DetectJson, name: string) {
  return result.linters.find((l) => l.name === name)?.customRules;
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

  it("detects oxlint from .oxlintrc.json", async () => {
    await writeFile(join(cwd, ".oxlintrc.json"), "{}", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("oxlint");
    expect(linterNames(result)).not.toContain("eslint");
  });

  it("detects oxlint from a package.json devDependency", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { oxlint: "^1.0.0" } }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("oxlint");
  });

  it("does not report oxlint for an eslint-only repo", async () => {
    await writeFile(join(cwd, ".eslintrc.json"), "{}", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { eslint: "^9.0.0" } }),
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).toContain("eslint");
    expect(linterNames(result)).not.toContain("oxlint");
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

  it.each([
    [
      "PEP 735 [dependency-groups]",
      '[dependency-groups]\ndev = [{ include-group = "test" }, "ruff>=0.6"]\ntest = ["pytest"]\n',
    ],
    ["[tool.uv] dev-dependencies", '[tool.uv]\ndev-dependencies = ["ruff"]\n'],
    [
      "[tool.pdm.dev-dependencies]",
      '[tool.pdm.dev-dependencies]\nlint = ["ruff==0.6.0"]\n',
    ],
    [
      "a Hatch environment",
      '[tool.hatch.envs.lint]\ndependencies = ["ruff"]\n',
    ],
    [
      "a Poetry dependency group",
      '[tool.poetry.group.dev.dependencies]\nruff = "^0.6"\n',
    ],
  ])(
    "detects ruff installed only as a dev dependency in %s",
    async (_location, toml) => {
      // No [tool.ruff] table: ruff running on its defaults is still a linter.
      await writeFile(
        join(cwd, "pyproject.toml"),
        `[project]\nname = "x"\n\n${toml}`,
        "utf8"
      );
      const result = await detect(cwd);
      expect(linterNames(result)).toContain("ruff");
    }
  );

  it("does not read a Poetry group's name as a dependency", async () => {
    await writeFile(
      join(cwd, "pyproject.toml"),
      '[tool.poetry.group.ruff.dependencies]\npytest = "^8"\n',
      "utf8"
    );
    const result = await detect(cwd);
    expect(linterNames(result)).not.toContain("ruff");
  });

  describe("a linter installed or run the way its ecosystem defaults to", () => {
    // Each fixture is the whole repository: no dedicated config file, which is
    // how these tools usually run.
    it.each([
      [
        "clippy",
        "Cargo.toml [lints.clippy]",
        {
          "Cargo.toml":
            '[package]\nname = "x"\n\n[lints.clippy]\npedantic = "warn"\n',
        },
      ],
      [
        "clippy",
        "Cargo.toml [workspace.lints.clippy]",
        {
          "Cargo.toml":
            '[workspace]\nmembers = []\n\n[workspace.lints.clippy]\nall = "deny"\n',
        },
      ],
      [
        "clippy",
        ".github/workflows/ci.yml (cargo +nightly clippy)",
        {
          "Cargo.toml": '[package]\nname = "x"\n',
          ".github/workflows/ci.yml":
            "jobs:\n  lint:\n    steps:\n      - run: cargo +nightly clippy -- -D warnings\n",
        },
      ],
      [
        "rubocop",
        "dependency rubocop (Gemfile)",
        {
          Gemfile:
            'source "https://rubygems.org"\ngem "rubocop", require: false\n',
        },
      ],
      [
        "standard",
        "dependency standard (Gemfile)",
        { Gemfile: "gem 'standard'\n" },
      ],
      [
        "phpstan",
        "dependency phpstan/phpstan (composer.json)",
        { "composer.json": '{"require-dev":{"phpstan/phpstan":"^2"}}' },
      ],
      [
        "pint",
        "dependency laravel/pint (composer.json)",
        { "composer.json": '{"require-dev":{"laravel/pint":"^1"}}' },
      ],
      [
        "golangci-lint",
        "dependency github.com/golangci/golangci-lint (go.mod)",
        {
          "go.mod":
            "module x\n\ngo 1.24\n\ntool (\n\tgithub.com/golangci/golangci-lint/v2/cmd/golangci-lint\n)\n",
        },
      ],
      [
        "golangci-lint",
        "dependency github.com/golangci/golangci-lint (go.mod)",
        {
          "go.mod":
            "module x\n\ngo 1.24\n\nrequire github.com/golangci/golangci-lint v1.64.8 // indirect\n",
        },
      ],
      [
        "phpstan",
        "dependency phpstan/phpstan (composer.json)",
        { "composer.json": '{"require":{"phpstan/phpstan":"^2"}}' },
      ],
      [
        "swiftlint",
        "dependency github.com/realm/swiftlint (Package.swift)",
        {
          "Package.swift":
            'dependencies: [\n  .package(url: "https://github.com/realm/SwiftLint.git", from: "0.57.0"),\n]\n',
        },
      ],
      [
        "flake8",
        "setup.cfg [flake8]",
        { "setup.cfg": "[flake8]\nmax-line-length = 100\n" },
      ],
      [
        "flake8",
        "tox.ini [flake8]",
        { "tox.ini": "[tox]\n\n[flake8]\nextend-ignore = E203\n" },
      ],
      [
        "ruff",
        "dependency ruff (requirements/dev.txt)",
        { "requirements/dev.txt": "ruff==0.6.0\n" },
      ],
      [
        "ruff",
        "dependency ruff (requirements-dev.txt)",
        { "requirements-dev.txt": "-r requirements.txt\nruff\n" },
      ],
      [
        "ruff",
        ".pre-commit-config.yaml (astral-sh/ruff-pre-commit)",
        {
          ".pre-commit-config.yaml":
            "repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    hooks:\n      - id: ruff\n",
        },
      ],
      [
        "prettier",
        "package.json (prettier)",
        { "package.json": '{"prettier":{"semi":false}}' },
      ],
      [
        "stylelint",
        "package.json (stylelint)",
        { "package.json": '{"stylelint":{}}' },
      ],
      [
        "prettier",
        "prettier.config.ts",
        { "prettier.config.ts": "export default {};\n" },
      ],
      [
        "eslint",
        "eslint.config.mts",
        { "eslint.config.mts": "export default [];\n" },
      ],
    ])("detects %s from %s", async (name, expected, files) => {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(cwd, path, ".."), { recursive: true });
        await writeFile(join(cwd, path), content, "utf8");
      }
      const result = await detect(cwd);
      expect(
        result.linters.find((linter) => linter.name === name)?.evidence
      ).toContain(expected);
    });

    it("reports Python for a repository whose only manifest is a requirements file", async () => {
      await mkdir(join(cwd, "requirements"), { recursive: true });
      await writeFile(join(cwd, "requirements/docs.txt"), "sphinx\n", "utf8");
      const result = await detect(cwd);
      expect(result.languages).toContain("Python");
    });

    it("does not report clippy for a Rust repository that never configures or runs it", async () => {
      // clippy ships with the toolchain, so being Rust is not evidence of it.
      await writeFile(
        join(cwd, "Cargo.toml"),
        '[package]\nname = "x"\n',
        "utf8"
      );
      const result = await detect(cwd);
      expect(linterNames(result)).not.toContain("clippy");
      expect(result.languages).toContain("Rust");
    });

    it.each([
      [
        "a workflow comment and step name",
        ".github/workflows/ci.yml",
        "# TODO: switch to golangci-lint\njobs:\n  test:\n    steps:\n      - name: golangci-lint is not used here\n        run: go test ./...\n",
      ],
      [
        "a commented-out hook command",
        ".husky/pre-commit",
        "#!/bin/sh\n# golangci-lint run\ngo vet ./...\n",
      ],
      [
        "a Jenkinsfile comment",
        "Jenkinsfile",
        "// golangci-lint runs elsewhere\npipeline { stages { stage('t') { steps { sh 'go test ./...' } } } }\n",
      ],
    ])("does not read an invocation from %s", async (_case, path, content) => {
      await mkdir(join(cwd, path, ".."), { recursive: true });
      await writeFile(join(cwd, path), content, "utf8");
      const result = await detect(cwd);
      expect(linterNames(result)).not.toContain("golangci-lint");
    });

    it.each([
      [".gitlab-ci.yml", "lint:\n  script:\n    - golangci-lint run\n"],
      [
        ".circleci/config.yml",
        "jobs:\n  lint:\n    steps:\n      - run:\n          command: golangci-lint run\n",
      ],
      [".husky/pre-commit", "#!/bin/sh\ngolangci-lint run\n"],
      [".lintstagedrc", '{"*.go": "golangci-lint run"}'],
      [
        ".husky/pre-commit",
        '#!/bin/sh\necho "checking # lint rules" && golangci-lint run\n',
      ],
      [
        "Jenkinsfile",
        "pipeline { stages { stage('l') { steps { sh \"echo 'see //lint' && golangci-lint run\" } } } }\n",
      ],
    ])("reads an invocation from the commands in %s", async (path, content) => {
      await mkdir(join(cwd, path, ".."), { recursive: true });
      await writeFile(join(cwd, path), content, "utf8");
      const result = await detect(cwd);
      expect(
        result.linters.find((linter) => linter.name === "golangci-lint")
          ?.evidence
      ).toContain(`${path} (golangci-lint)`);
    });

    it("does not read an invocation from a CI config below the root", async () => {
      await mkdir(join(cwd, "vendor-tool/.github/workflows"), {
        recursive: true,
      });
      await writeFile(
        join(cwd, "vendor-tool/.github/workflows/ci.yml"),
        "steps:\n  - run: golangci-lint run\n",
        "utf8"
      );
      const result = await detect(cwd);
      expect(linterNames(result)).not.toContain("golangci-lint");
    });
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
    await mkdir(join(cwd, ".taskless", "rules", "sg"), { recursive: true });
    const result = await detect(cwd);
    expect(
      result.ruleStyles.some((s) => s.source === ".taskless/rules/sg")
    ).toBe(true);
  });

  it("emits a stable JSON shape with only signal keys (no packaged-rule claims)", async () => {
    await writeFile(join(cwd, ".eslintrc.json"), "{}", "utf8");
    const result = await detect(cwd);
    expect(Object.keys(result).toSorted()).toEqual(
      [
        "agent",
        "ci",
        "hooks",
        "hostTools",
        "languages",
        "linters",
        "ruleStyles",
        "success",
      ].toSorted()
    );
    // A linter entry exposes name, evidence, and a count of the repository's
    // own rules, never a rule-name claim.
    for (const linter of result.linters) {
      for (const key of Object.keys(linter)) {
        expect(["customRules", "evidence", "name"]).toContain(key);
      }
    }
  });

  it("detects ast-grep from sgconfig.yml", async () => {
    await writeFile(join(cwd, "sgconfig.yml"), "ruleDirs: []\n", "utf8");
    const result = await detect(cwd);
    expect(result.linters).toContainEqual({
      name: "ast-grep",
      evidence: ["sgconfig.yml"],
    });
    // Polyglot: it says nothing about what the repository is written in.
    expect(result.languages).toEqual([]);
  });

  it("detects vale from .vale.ini", async () => {
    await writeFile(join(cwd, ".vale.ini"), "StylesPath = styles\n", "utf8");
    const result = await detect(cwd);
    expect(result.linters).toContainEqual({
      name: "vale",
      evidence: [".vale.ini"],
    });
  });

  // Taskless writes its own `sgconfig.yml` and `.vale.ini` under `.taskless/`.
  // Reading those as the repository's linters would report every installed
  // repository as already running both.
  it("does not read Taskless's own configuration as the repository's linters", async () => {
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(join(cwd, ".taskless", "sgconfig.yml"), "", "utf8");
    await writeFile(join(cwd, ".taskless", ".vale.ini"), "", "utf8");
    const result = await detect(cwd);
    expect(linterNames(result)).not.toContain("ast-grep");
    expect(linterNames(result)).not.toContain("vale");
  });

  it("reports host tools in a fixed order, and hints only for usable ones", async () => {
    // Not a repository, so neither forge tool can apply here whatever is
    // installed on the machine running the tests.
    const result = await detect(cwd);
    expect(result.hostTools.map((tool) => tool.name)).toEqual([
      "gh",
      "git",
      "jq",
      "glab",
    ]);
    expect(result.hostTools.find((tool) => tool.name === "gh")).toMatchObject({
      applicable: false,
      reason: "this repository has no GitHub origin",
    });
    expect(result.hostTools.find((tool) => tool.name === "glab")).toMatchObject(
      {
        applicable: false,
        reason: "this repository has no GitLab origin",
      }
    );
    expect(Object.keys(result.agent)).not.toContain("gh auth status");
    expect(Object.keys(result.agent)).not.toContain("glab auth status");
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

  describe("custom-rule counts", () => {
    it("counts the rules in a house ESLint rule directory", async () => {
      await writeFile(join(cwd, "eslint.config.js"), "export default [];");
      await mkdir(join(cwd, "eslint-rules", "no-foo"), { recursive: true });
      for (const file of [
        "a.js",
        "b.ts",
        "c.mjs",
        "d.cjs",
        "e.js",
        "f.js",
        "index.js",
        "a.test.js",
        "types.d.ts",
        "README.md",
      ]) {
        await writeFile(join(cwd, "eslint-rules", file), "");
      }
      await mkdir(join(cwd, "eslint-rules", "__tests__"));
      const rules = customRules(await detect(cwd), "eslint");
      // Six files and the no-foo rule folder; index, tests, declarations,
      // docs, and the tests folder are not rules.
      expect(rules?.count).toBe(7);
      expect(rules?.evidence).toEqual(["eslint-rules (7 rules)"]);
    });

    it("reports a preset-only ESLint config as zero", async () => {
      await writeFile(
        join(cwd, "eslint.config.js"),
        'import js from "@eslint/js";\nexport default [js.configs.recommended];\n'
      );
      expect(customRules(await detect(cwd), "eslint")).toEqual({
        count: 0,
        evidence: [],
      });
    });

    it("reports a plugin imported from a local file as unknown", async () => {
      await writeFile(
        join(cwd, "eslint.config.js"),
        'import local from "./tools/lint-plugin.js";\nexport default [{ plugins: { local } }];\n'
      );
      const rules = customRules(await detect(cwd), "eslint");
      expect(rules?.count).toBe("unknown");
      expect(rules?.evidence).toEqual([
        "eslint.config.js (plugin imported from a local file)",
      ]);
    });

    it("reports an inline plugin as unknown", async () => {
      await writeFile(
        join(cwd, "eslint.config.mjs"),
        "export default [{ plugins: { house: { rules: { a: { create(context) { return {}; } } } } } }];\n"
      );
      expect(customRules(await detect(cwd), "eslint")?.count).toBe("unknown");
    });

    it("counts Biome plugins across nested configs, reading JSONC", async () => {
      await writeFile(
        join(cwd, "biome.jsonc"),
        '{\n  // house rules\n  "$schema": "https://biomejs.dev/schemas/2.6.2/schema.json",\n  "plugins": ["./a.grit", "./b.grit",],\n}\n'
      );
      await mkdir(join(cwd, "packages", "web"), { recursive: true });
      await writeFile(
        join(cwd, "packages", "web", "biome.json"),
        '{ "root": false, "plugins": ["./c.grit"] }'
      );
      const rules = customRules(await detect(cwd), "biome");
      expect(rules?.count).toBe(3);
      expect(rules?.evidence.toSorted()).toEqual(
        [
          "biome.jsonc (2 plugins)",
          "packages/web/biome.json (1 plugins)",
        ].toSorted()
      );
    });

    it("counts pylint plugins that live in the repository", async () => {
      await writeFile(
        join(cwd, ".pylintrc"),
        "[MAIN]\nload-plugins = house.checkers,\n  pylint.extensions.docparams,\n  pylint_django\n"
      );
      await mkdir(join(cwd, "house"), { recursive: true });
      await writeFile(join(cwd, "house", "checkers.py"), "");
      const rules = customRules(await detect(cwd), "pylint");
      expect(rules).toEqual({
        count: 1,
        evidence: [".pylintrc load-plugins house.checkers"],
      });
    });

    it("does not count pylint's own extensions", async () => {
      await writeFile(
        join(cwd, "pyproject.toml"),
        '[tool.pylint.main]\nload-plugins = ["pylint.extensions.bad_builtin"]\n'
      );
      expect(customRules(await detect(cwd), "pylint")?.count).toBe(0);
    });

    it("counts flake8 local plugins and published entry points", async () => {
      await writeFile(
        join(cwd, ".flake8"),
        "[flake8]\nmax-line-length = 100\n\n[flake8:local-plugins]\nextension =\n  HSE1 = house.flake8:NoFoo\n  HSE2 = house.flake8:NoBar\npaths = ./tools\n"
      );
      await writeFile(
        join(cwd, "pyproject.toml"),
        '[project]\nname = "house"\n\n[project.entry-points."flake8.extension"]\nHSE3 = "house.plugin:NoBaz"\n'
      );
      const rules = customRules(await detect(cwd), "flake8");
      expect(rules?.count).toBe(3);
    });

    it("reports Ruff as zero however it is configured", async () => {
      await writeFile(
        join(cwd, "ruff.toml"),
        '[lint]\nextend-select = ["TID"]\n[lint.flake8-tidy-imports.banned-api]\n"requests.get".msg = "use the client"\n'
      );
      expect(customRules(await detect(cwd), "ruff")).toEqual({
        count: 0,
        evidence: [],
      });
    });

    it("gives no count to a linter that cannot hold a custom rule", async () => {
      await writeFile(join(cwd, ".prettierrc"), "{}");
      expect(customRules(await detect(cwd), "prettier")).toBeUndefined();
    });
  });

  describe("CI systems and commit hooks", () => {
    it("reports both as empty arrays on a bare repository", async () => {
      const result = await detect(cwd);
      expect(result.ci).toEqual([]);
      expect(result.hooks).toEqual([]);
    });

    it("reports each GitHub Actions workflow file as evidence", async () => {
      await mkdir(join(cwd, ".github", "workflows"), { recursive: true });
      await writeFile(join(cwd, ".github/workflows/test.yml"), "", "utf8");
      await writeFile(join(cwd, ".github/workflows/release.yaml"), "", "utf8");
      const result = await detect(cwd);
      expect(result.ci).toEqual([
        {
          name: "github-actions",
          evidence: [
            ".github/workflows/test.yml",
            ".github/workflows/release.yaml",
          ],
        },
      ]);
    });

    it.each([
      ["gitlab-ci", ".gitlab-ci.yml"],
      ["circleci", ".circleci/config.yml"],
      ["jenkins", "Jenkinsfile"],
      ["azure-pipelines", "azure-pipelines.yml"],
      ["bitbucket-pipelines", "bitbucket-pipelines.yml"],
      ["drone", ".drone.yml"],
      ["travis-ci", ".travis.yml"],
    ])("detects %s from %s", async (name, file) => {
      await mkdir(join(cwd, file, ".."), { recursive: true });
      await writeFile(join(cwd, file), "", "utf8");
      const result = await detect(cwd);
      expect(result.ci).toEqual([{ name, evidence: [file] }]);
    });

    it("detects buildkite from its directory", async () => {
      await mkdir(join(cwd, ".buildkite"));
      const result = await detect(cwd);
      expect(result.ci).toEqual([
        { name: "buildkite", evidence: [".buildkite/"] },
      ]);
    });

    it("does not report a CI config below the scan root", async () => {
      await mkdir(join(cwd, "packages", "api"), { recursive: true });
      await writeFile(join(cwd, "packages/api/.gitlab-ci.yml"), "", "utf8");
      const result = await detect(cwd);
      expect(result.ci).toEqual([]);
    });

    it("detects husky and lint-staged from the root package.json", async () => {
      await mkdir(join(cwd, ".husky"));
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          devDependencies: { husky: "^9.0.0", "lint-staged": "^15.0.0" },
          "lint-staged": { "*": "prettier --check" },
        }),
        "utf8"
      );
      const result = await detect(cwd);
      expect(result.hooks).toEqual([
        {
          name: "husky",
          evidence: [".husky/", "dependency husky (package.json)"],
        },
        {
          name: "lint-staged",
          evidence: [
            "package.json (lint-staged)",
            "dependency lint-staged (package.json)",
          ],
        },
      ]);
    });

    it.each([
      ["lefthook", "lefthook.yml"],
      ["pre-commit", ".pre-commit-config.yaml"],
      ["simple-git-hooks", ".simple-git-hooks.json"],
      ["lint-staged", ".lintstagedrc.json"],
    ])("detects %s from %s", async (name, file) => {
      await writeFile(join(cwd, file), "", "utf8");
      const result = await detect(cwd);
      expect(result.hooks).toEqual([{ name, evidence: [file] }]);
    });

    it("does not report a hook tool named only by a sub-package", async () => {
      await mkdir(join(cwd, "packages", "web"), { recursive: true });
      await writeFile(
        join(cwd, "packages/web/package.json"),
        JSON.stringify({ devDependencies: { husky: "^9.0.0" } }),
        "utf8"
      );
      const result = await detect(cwd);
      expect(result.hooks).toEqual([]);
    });
  });
});
