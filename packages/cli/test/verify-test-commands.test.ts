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

  // Found by running the recipe's own worked `consistency` rule under the
  // rule-directory layout. Vale compiles a consistency rule's name into its
  // pattern as an RE2 group name, so a hyphen fails the file with E201 — and
  // since Vale reads one config for the whole run, that one rule silences
  // every Vale rule in the project. Caught at authoring time instead.
  it("rejects a hyphenated id on a consistency rule", async () => {
    await valeRule("ize-ise", {
      config: SCOPED.replaceAll("no-simply", "ize-ise"),
      style: `extends: consistency\nmessage: "Use '%s' consistently"\nlevel: warning\nnonword: true\neither:\n  organize: organise\n`,
    });
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(
      (JSON.parse(result.stdout) as Report).rules[0]?.errors.join(" ")
    ).toContain("group name");
  });

  it("accepts a hyphenated id on every other extension point", async () => {
    await valeRule("no-simply", { config: SCOPED });
    const result = await runCli(["verify", "-d", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
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

/**
 * The schema layer, through the real CLI.
 *
 * `vale-schema-contract.test.ts` holds the schema to the binary. These say the
 * layer is actually wired into `verify` — that an author running the command
 * hears about the defect, and hears it in words that name the field.
 *
 * Every rule here is one Vale would have accepted into its config and then
 * failed to honor. Two of the three take the *whole run* down when they reach
 * the binary, so catching them at `verify` is not a convenience.
 */
/** Verify one style file, assert it failed, and hand back what it said. */
async function verifyErrors(style: string): Promise<string> {
  await valeRule("no-simply", { config: SCOPED, style });
  const result = await runCli([
    "verify",
    ".taskless/rules/vale/no-simply",
    "-d",
    cwd,
    "--json",
  ]);
  const report = JSON.parse(result.stdout) as Report;
  expect(report.ok).toBe(false);
  expect(result.exitCode).not.toBe(0);
  return report.rules[0]?.errors.join("\n") ?? "";
}

withVale("verify schema-checks a Vale rule", () => {
  it("rejects an extends that is not a check type, naming the accepted set", async () => {
    const errors = await verifyErrors(
      `extends: nonsense\nmessage: "x"\nlevel: warning\ntokens:\n  - simply\n`
    );
    expect(errors).toContain("extends");
    expect(errors).toContain("nonsense");
    // The value of naming them: an author who skipped `readability` after
    // reading the docs' eleven needs to see that it is a real check type.
    expect(errors).toContain("readability");
    expect(errors).toContain("existence");
  });

  it("rejects an unrecognized scope", async () => {
    // The one defect nothing downstream catches: Vale loads this rule, runs
    // it, and matches nothing, with no error at any layer.
    const errors = await verifyErrors(
      `extends: existence\nmessage: "x"\nlevel: warning\nscope: fenced\ntokens:\n  - simply\n`
    );
    expect(errors).toContain("scope");
    expect(errors).toContain("fenced");
  });

  it("accepts ~ negation and & chaining over recognized operands", async () => {
    await valeRule("no-simply", {
      config: SCOPED,
      style: `extends: existence\nmessage: "x"\nlevel: warning\nscope: text & ~code\ntokens:\n  - simply\n`,
    });
    const result = await runCli([
      "verify",
      ".taskless/rules/vale/no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect((JSON.parse(result.stdout) as Report).ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("rejects a field belonging to another check type", async () => {
    const errors = await verifyErrors(
      `extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\ntokens:\n  - simply\n`
    );
    expect(errors).toContain("tokens");
    expect(errors).toContain("occurrence");
    // The blast radius is the reason this one is worth catching early, so the
    // message has to carry it.
    expect(errors).toContain("E201");
  });

  it("still verifies a rule with no fixtures", async () => {
    // The split between `verify` and `test` exists for the agent part-way
    // through authoring. Adding a schema layer must not quietly close it.
    await valeRule("no-simply", { config: SCOPED });
    const result = await runCli([
      "verify",
      ".taskless/rules/vale/no-simply",
      "-d",
      cwd,
      "--json",
    ]);
    expect((JSON.parse(result.stdout) as Report).ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("verifies the rule shapes the recipe teaches", async () => {
    // The regression guard for "no rule that works today starts failing".
    // Each of these is a worked example from `create-vale-rule`.
    const recipeRules: Record<string, string> = {
      hedging: `extends: existence\nmessage: "Avoid hedging: '%s'"\nlevel: warning\nignorecase: true\ntokens:\n  - we think\n`,
      products: `extends: substitution\nmessage: "Use '%s' instead of '%s'"\nlevel: error\nignorecase: true\nswap:\n  github: GitHub\n`,
      headings: `extends: capitalization\nmessage: "'%s' should be in sentence case"\nlevel: warning\nscope: heading\nmatch: $sentence\nexceptions:\n  - Taskless\n`,
      linktext: `extends: existence\nmessage: "Link text '%s' says nothing"\nlevel: warning\nscope: link\nignorecase: true\ntokens:\n  - click here\n`,
      bangs: `extends: occurrence\nmessage: "Too many exclamation marks"\nlevel: warning\nscope: paragraph\ntoken: "!"\nmax: 1\n`,
      doubled: `extends: repetition\nmessage: "'%s' is repeated"\nlevel: warning\nalpha: true\ntokens:\n  - '[^\\s]+'\n`,
      izeise: `extends: consistency\nmessage: "Use '%s' consistently"\nlevel: warning\nnonword: true\neither:\n  organize: organise\n`,
      acronyms: `extends: conditional\nmessage: "'%s' has no definition"\nlevel: warning\nscope: text\nignorecase: false\nfirst: '\\b([A-Z]{3,5})\\b'\nsecond: '(?:\\b[A-Z][a-z]+ )+\\(([A-Z]{3,5})\\)'\n`,
      emdash: `extends: existence\nmessage: "Use a comma, not an em dash"\nlevel: warning\nnonword: true\ntokens:\n  - '—'\n`,
    };
    for (const [id, style] of Object.entries(recipeRules)) {
      await valeRule(id, {
        style,
        config: `[*.md]\ntskl) rule = ${id}\nBasedOnStyles =\n${id}.${id} = YES\n`,
      });
    }

    const result = await runCli([
      "verify",
      ".taskless/rules/vale",
      "-d",
      cwd,
      "--json",
    ]);
    const report = JSON.parse(result.stdout) as Report;
    const failed = report.rules.filter((rule) => !rule.ok);
    expect(
      failed.map((rule) => `${rule.ruleId}: ${rule.errors.join("; ")}`)
    ).toEqual([]);
    expect(report.rules).toHaveLength(Object.keys(recipeRules).length);
  });
});

/**
 * The ordering property, for the defects that are not local.
 *
 * A foreign field is `E201` and an unknown `extends` fails the config outright.
 * Vale reads one assembled config per run, so either one reaching the binary
 * takes down every Vale rule in the project. `verify` is a pure read of the
 * rule's own files, and `test` runs it first and stops — so neither defect can
 * get as far as a Vale invocation.
 */
withVale("a rule Vale would choke on never reaches Vale", () => {
  it("stops `test` at verify for a foreign field, without running the fixtures", async () => {
    await valeRule("no-simply", {
      config: SCOPED,
      fixtures: true,
      style: `extends: occurrence\nmessage: "x"\nlevel: warning\nscope: sentence\ntoken: very\nmax: 1\ntokens:\n  - simply\n`,
    });
    const result = await runCli(["test", "-d", cwd, "--json"]);
    expect(result.exitCode).not.toBe(0);
    const rule = (
      JSON.parse(result.stdout) as {
        rules: { ok: boolean; ran: boolean; errors: string[] }[];
      }
    ).rules[0];
    // `ran: false` is the assertion that matters: the fixtures were never
    // linted, so Vale was never asked to load this config.
    expect(rule?.ran).toBe(false);
    expect(rule?.errors.join(" ")).toContain("occurrence");
    // And the fixture complaint does not crowd out the real one.
    expect(rule?.errors.join(" ")).not.toContain("did not fire");
  });

  it("stops `test` at verify for an unknown extends", async () => {
    await valeRule("no-simply", {
      config: SCOPED,
      fixtures: true,
      style: `extends: nonsense\nmessage: "x"\nlevel: warning\ntokens:\n  - simply\n`,
    });
    const result = await runCli(["test", "-d", cwd, "--json"]);
    const rule = (
      JSON.parse(result.stdout) as {
        rules: { ran: boolean; errors: string[] }[];
      }
    ).rules[0];
    expect(rule?.ran).toBe(false);
    expect(rule?.errors.join(" ")).toContain("nonsense");
  });
});
