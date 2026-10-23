import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getRecipe } from "../src/prompts/recipes";

/**
 * The linter behaviour the `create-legacy-rule` recipes describe, pinned.
 *
 * Unlike ast-grep and Vale, Taskless does not ship these linters, so each
 * one is fetched at a pinned version (`uvx` for Python, `pnpm dlx` for
 * Biome) and asked directly. A bump that changes one of these fails here,
 * naming the recipe sentence that rests on it, instead of an agent acting
 * on a recipe that is no longer true.
 *
 * OPT-IN, because it downloads packages. `TASKLESS_LEGACY_LINTER_CONTRACT=1`
 * runs it; the `legacy-linter-contract` workflow sets it.
 */
const ENABLED = process.env.TASKLESS_LEGACY_LINTER_CONTRACT === "1";

const RUFF = "ruff==0.17.2";
const PYLINT = "pylint==4.1.3";
const FLAKE8 = "flake8==7.4.1";
const FLAKE8_TIDY_IMPORTS = "flake8-tidy-imports";
const BIOME = "@biomejs/biome@2.6.2";

let workdir: string;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: workdir,
    encoding: "utf8",
    timeout: 120_000,
    // `ruff rule --all` prints every rule's full documentation.
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    // stdout alone, for output that is parsed: on a cold cache `uvx` reports
    // what it installed on stderr.
    stdout: result.stdout ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function recipe(tool: string): string {
  return getRecipe("create-legacy-rule", { tool }) ?? "";
}

describe.skipIf(!ENABLED)("legacy linter vendor contract", () => {
  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), "taskless-legacy-contract-"));
  });
  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe("ruff", () => {
    it("reports preview status in `ruff rule` JSON, which the recipe tells the agent to check", () => {
      const { status, stdout } = run("uvx", [
        RUFF,
        "rule",
        "--all",
        "--output-format",
        "json",
      ]);
      expect(status).toBe(0);
      const rules = JSON.parse(stdout) as Array<Record<string, unknown>>;
      expect(rules.length).toBeGreaterThan(400);
      for (const key of ["code", "name", "preview"]) {
        expect(rules[0]).toHaveProperty(key);
      }
      expect(recipe("ruff")).toContain(
        '**"This rule is in preview and is not stable."**'
      );
    });

    it("says a preview rule is preview at the top of `ruff rule`", () => {
      const { output } = run("uvx", [
        RUFF,
        "rule",
        "unnecessary-regular-expression-compile",
      ]);
      expect(output).toContain("This rule is in preview and is not stable.");
    });

    it("has banned-api as TID251, derived from flake8-tidy-imports", () => {
      const { status, output } = run("uvx", [RUFF, "rule", "TID251"]);
      expect(status).toBe(0);
      expect(output).toContain("# banned-api (TID251)");
      expect(output).toContain(
        "Derived from the **flake8-tidy-imports** linter."
      );
    });

    it("fails on a rule the installed version does not have", () => {
      expect(run("uvx", [RUFF, "rule", "no-such-rule"]).status).not.toBe(0);
    });
  });

  describe("pylint", () => {
    it("does not know an extension's message until the extension is loaded", () => {
      const without = run("uvx", [
        "--from",
        PYLINT,
        "pylint",
        "--help-msg=bad-builtin",
      ]);
      expect(without.output).toContain("No such message id or symbol");
      const loaded = run("uvx", [
        "--from",
        PYLINT,
        "pylint",
        "--load-plugins=pylint.extensions.bad_builtin",
        "--help-msg=bad-builtin",
      ]);
      expect(loaded.output).toContain(":bad-builtin (W0141)");
      expect(recipe("pylint")).toContain(
        "`--load-plugins=pylint.extensions.bad_builtin`"
      );
    });

    it("has the catch-all options the recipe names", () => {
      const { output } = run("uvx", [
        "--from",
        PYLINT,
        "pylint",
        "--load-plugins=pylint.extensions.bad_builtin",
        "--help",
      ]);
      for (const option of [
        "--deprecated-modules",
        "--preferred-modules",
        "--bad-functions",
      ]) {
        expect(output).toContain(option);
      }
    });
  });

  describe("flake8", () => {
    it("reports a banned module as I251 through flake8-tidy-imports", () => {
      writeFileSync(join(workdir, "banned.py"), "import requests\n");
      writeFileSync(
        join(workdir, ".flake8"),
        "[flake8]\nbanned-modules =\n  requests = Use the client.\n"
      );
      const { output } = run("uvx", [
        "--from",
        FLAKE8,
        "--with",
        FLAKE8_TIDY_IMPORTS,
        "flake8",
        "banned.py",
      ]);
      expect(output).toContain("I251 Banned import 'requests' used");
      expect(recipe("flake8")).toContain("Its error code is `I251`.");
    });

    it("lists installed plugins as JSON with --bug-report", () => {
      const { status, stdout } = run("uvx", [
        "--from",
        FLAKE8,
        "flake8",
        "--bug-report",
      ]);
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toHaveProperty("plugins");
    });
  });

  describe("biome", () => {
    it("explains both catch-all rules, in the style group", () => {
      for (const rule of ["noRestrictedImports", "noRestrictedGlobals"]) {
        const { status, output } = run("pnpm", ["dlx", BIOME, "explain", rule]);
        expect(status).toBe(0);
        expect(output).toContain(`Diagnostic category: lint/style/${rule}`);
        expect(recipe("biome")).toContain(`\`${rule}\` (group \`style\`)`);
      }
    });

    it("fails to explain a rule it does not have", () => {
      expect(
        run("pnpm", ["dlx", BIOME, "explain", "noSuchRule"]).status
      ).not.toBe(0);
    });
  });
});
