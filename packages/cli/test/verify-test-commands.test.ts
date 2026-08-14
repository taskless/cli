import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

const withVale = findValeBinary().path === undefined ? describe.skip : describe;

let cwd: string;

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code,
    };
  }
}

interface Report {
  ok: boolean;
  rules: { engine: string; ruleId: string; ok: boolean; errors: string[] }[];
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-verify-cmd-"));
  await runCli(["init", "--no-interactive", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function valeRule(
  id: string,
  options: { config?: string; style?: string; fixtures?: boolean } = {}
): Promise<string> {
  const directory = join(cwd, ".taskless", "rules", "vale", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    options.style ??
      `extends: existence\nmessage: "Avoid %s"\nlevel: warning\ntokens:\n  - simply\n`
  );
  if (options.config !== undefined) {
    await writeFile(join(directory, ".vale.ini"), options.config);
  }
  if (options.fixtures ?? false) {
    await mkdir(join(directory, ".tests", "pass"), { recursive: true });
    await mkdir(join(directory, ".tests", "fail"), { recursive: true });
    await writeFile(
      join(directory, ".tests", "fail", "bad.md"),
      "You simply do it.\n"
    );
    await writeFile(join(directory, ".tests", "pass", "ok.md"), "You do it.\n");
  }
  return directory;
}

const SCOPED = `[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\n`;

describe("verify addresses rules by path", () => {
  it("resolves the engine from the path, not the file", async () => {
    await valeRule("no-simply", { config: SCOPED });
    const result = await runCli([
      "verify",
      ".taskless/rules/vale/no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.rules[0]?.engine).toBe("vale");
  });

  // The same id under two engines was the reason the id-addressed command
  // needed an ambiguity error at all. A path has no such case.
  it("keeps two engines' rules of the same id apart", async () => {
    await valeRule("shared", {
      config: SCOPED.replaceAll("no-simply", "shared"),
    });
    const sg = join(cwd, ".taskless", "rules", "sg", "shared");
    await mkdir(sg, { recursive: true });
    await writeFile(
      join(sg, "shared.yml"),
      "id: shared\nlanguage: TypeScript\nseverity: error\nmessage: x\nrule:\n  pattern: eval($A)\n"
    );

    const valeResult = await runCli([
      "verify",
      ".taskless/rules/vale/shared",
      "-d",
      cwd,
      "--json",
    ]);
    const vale = JSON.parse(valeResult.stdout) as Report;
    expect(vale.rules).toHaveLength(1);
    expect(vale.rules[0]?.engine).toBe("vale");

    const bothResult = await runCli(["verify", "-d", cwd, "--json"]);
    const both = JSON.parse(bothResult.stdout) as Report;
    expect(both.rules.map((rule) => rule.engine).toSorted()).toEqual([
      "sg",
      "vale",
    ]);
  });

  it("rejects a path outside the rules tree by name", async () => {
    const result = await runCli(["verify", "src", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not inside .taskless/rules/");
  });

  // A fresh install has no rules. Failing here would make `verify` unusable in
  // CI until someone writes the first one.
  it("succeeds with no rules present", async () => {
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as Report).rules).toEqual([]);
  });
});

describe("verify checks components without requiring tests", () => {
  it("passes a rule that has no fixtures yet", async () => {
    await valeRule("no-simply", { config: SCOPED });
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
  });

  // A Vale rule with no config declares no scope: it verifies, runs, and
  // reports nothing. That is the silent disable the layout exists to prevent.
  it("fails a Vale rule that nothing scopes", async () => {
    await valeRule("no-simply");
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.rules[0]?.errors.join(" ")).toContain("never run");
  });

  it("fails a Vale rule whose config never enables it", async () => {
    await valeRule("no-simply", { config: "[*.md]\nBasedOnStyles =\n" });
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(
      (JSON.parse(result.stdout) as Report).rules[0]?.errors.join(" ")
    ).toContain("present but off");
  });

  it("names a bad level rather than leaving it to an engine failure", async () => {
    await valeRule("no-simply", {
      config: SCOPED,
      style: `extends: existence\nmessage: "x"\nlevel: catastrophic\ntokens:\n  - simply\n`,
    });
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(
      (JSON.parse(result.stdout) as Report).rules[0]?.errors.join(" ")
    ).toContain("level");
  });
});

withVale("test runs verify first", () => {
  it("passes a rule that fires on fail/ and stays quiet on pass/", async () => {
    await valeRule("no-simply", { config: SCOPED, fixtures: true });
    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
  });

  // The ordering property: when a rule is both malformed and under-fixtured,
  // the malformation is the error the author needs, and it is the one that
  // gets buried if the fixture check runs first.
  it("reports the malformation, not the missing fixtures", async () => {
    await valeRule("no-simply", {
      config: SCOPED,
      style: `extends: existence\nlevel: warning\ntokens:\n  - simply\n`,
    });
    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    const errors =
      (JSON.parse(result.stdout) as Report).rules[0]?.errors.join(" ") ?? "";
    expect(errors).toContain("message");
    expect(errors).not.toContain("fixtures");
  });

  it("fails a one-sided fixture set", async () => {
    const directory = await valeRule("no-simply", {
      config: SCOPED,
      fixtures: true,
    });
    await rm(join(directory, ".tests", "pass"), {
      recursive: true,
      force: true,
    });
    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(
      (JSON.parse(result.stdout) as Report).rules[0]?.errors.join(" ")
    ).toContain("half a claim");
  });
});
