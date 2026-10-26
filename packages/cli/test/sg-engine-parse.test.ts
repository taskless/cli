import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cliRejectionToResult } from "./support/spawn-cli";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();

let cwd: string;

async function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return cliRejectionToResult(error, [binPath, ...args]);
  }
}

interface Report {
  ok: boolean;
  rules: {
    ruleId: string;
    ok: boolean;
    errors: string[];
    violations: { constraintId: string; message: string }[];
    notices: string[];
  }[];
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-sg-parse-"));
  await runCli(["init", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** Write one fixture case holding a single `sample.ts`. */
async function fixtureCase(
  id: string,
  bucket: "pass" | "fail",
  name: string,
  source: string
) {
  const directory = join(
    cwd,
    ".taskless",
    "rules",
    "sg",
    id,
    "tests",
    bucket,
    name
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "sample.ts"), source);
}

/** An sg rule with one case in each fixture bucket, `body` written verbatim. */
async function sgRule(id: string, body: string, language = "TypeScript") {
  const directory = join(cwd, ".taskless", "rules", "sg", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `id: ${id}\nlanguage: ${language}\nseverity: error\nmessage: m\n${body}`
  );
  await fixtureCase(id, "pass", "plain-call", "foo(x);\n");
  await fixtureCase(id, "fail", "eval-call", "eval(x);\n");
}

const GOOD =
  'rule:\n  kind: call_expression\n  has: { field: function, kind: identifier, regex: "^eval$" }\n';
/** Passes the schema, refused by ast-grep: `readonly` is a keyword token. */
const KEYWORD_KIND = "rule:\n  kind: readonly\n";

async function report(command: string, path: string): Promise<Report> {
  const result = await runCli([command, path, "-d", cwd, "--json"]);
  return JSON.parse(result.stdout) as Report;
}

describe("validate parses each sg rule with ast-grep, alone", () => {
  it("rejects a kind the grammar does not have, in ast-grep's words", async () => {
    await sgRule("kw", KEYWORD_KIND);
    const { rules } = await report("validate", ".taskless/rules/sg/kw");
    expect(rules[0]?.ok).toBe(false);
    expect(rules[0]?.errors.join("\n")).toContain("Kind `readonly` is invalid");
  });

  // Each shape reaches a different part of the cause-chain parsing, and each
  // was measured on 0.45.3. The specific cause has to survive: a reformat that
  // dropped it would still fail the rule, but with the generic exit-code
  // message, and only these assertions would notice.
  it.each([
    {
      shape: "a Markdown inline kind",
      body: "rule:\n  kind: link\n",
      language: "Markdown",
      expected: "Kind `link` is invalid",
    },
    {
      // A one-link chain, with no context to put in parentheses.
      shape: "a pattern with no AST kind",
      body: 'rule:\n  pattern: "foo("\n',
      language: "TypeScript",
      expected: "Rule must specify a set of AST kinds to match",
    },
    {
      // The specific part arrives on a later line, after the pattern and a
      // caret, as `error: ...`; it is folded into the last link.
      shape: "a regex that does not compile",
      body: 'rule:\n  kind: identifier\n  regex: "(["\n',
      language: "TypeScript",
      expected: "regex parse error: unclosed character class",
    },
  ])(
    "names the specific cause for $shape",
    async ({ body, language, expected }) => {
      await sgRule("refused", body, language);
      const { rules } = await report("validate", ".taskless/rules/sg/refused");
      const errors = rules[0]?.errors.join("\n") ?? "";
      expect(rules[0]?.ok).toBe(false);
      expect(errors).toContain(`ast-grep refuses this rule: ${expected}`);
      expect(errors).not.toContain("(exit ");
    }
  );

  it("attaches no constraint id to the engine's refusal", async () => {
    await sgRule("kw", KEYWORD_KIND);
    const { rules } = await report("validate", ".taskless/rules/sg/kw");
    expect(rules[0]?.violations).toEqual([]);
  });

  it("reports the error under the rule that has it, and only there", async () => {
    await sgRule("kw", KEYWORD_KIND);
    await sgRule("good", GOOD);
    const { rules } = await report("validate", ".taskless/rules/sg");
    const byId = Object.fromEntries(rules.map((rule) => [rule.ruleId, rule]));
    expect(byId.kw?.ok).toBe(false);
    expect(byId.good?.ok).toBe(true);
    expect(byId.good?.errors).toEqual([]);
  });
});

describe("validate refuses a top-level strictness", () => {
  it("names the constraint and where the key belongs", async () => {
    await sgRule("loose", `strictness: ast\n${GOOD}`);
    const { rules } = await report("validate", ".taskless/rules/sg/loose");
    expect(rules[0]?.ok).toBe(false);
    expect(rules[0]?.violations.map((v) => v.constraintId)).toEqual([
      "sg-no-top-level-strictness",
    ]);
    expect(rules[0]?.errors.join("\n")).toContain("pattern object");
  });
});

describe("verify judges an sg rule on its own fixtures", () => {
  // #489, gap 2. Under the project-wide config `kw` failed `good`'s fixture
  // run with "Cannot parse rule .../kw/kw.yml", reported under `good`.
  it("is not failed by another rule ast-grep refuses", async () => {
    await sgRule("kw", KEYWORD_KIND);
    await sgRule("good", GOOD);
    const { rules } = await report("verify", ".taskless/rules/sg/good");
    expect(rules[0]?.ok).toBe(true);
    expect(rules[0]?.errors).toEqual([]);
  });

  // Its own temporary directory, so a `verify` another test file runs in
  // parallel cannot put a directory there between the run and the listing.
  it("leaves no config behind, in the project or the temporary directory", async () => {
    await sgRule("good", GOOD);
    const scratch = await mkdtemp(join(tmpdir(), "tskl-sg-tmp-"));
    try {
      const result = await runCli(
        ["verify", ".taskless/rules/sg/good", "-d", cwd, "--json"],
        { TMPDIR: scratch, TMP: scratch, TEMP: scratch }
      );
      expect(result.exitCode).toBe(0);
      expect(await readdir(scratch)).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    const ruleDirectory = await readdir(
      join(cwd, ".taskless", "rules", "sg", "good")
    );
    expect(ruleDirectory.toSorted()).toEqual(["good.yml", "tests"]);
  });

  it("passes a rule whose only findings from validate are trap notices", async () => {
    // A statement calling eval that follows another statement. `follows` has
    // no `stopBy`, which draws the sibling notice (and the callee regex under
    // TypeScript draws the awaited-call one); neither is a failure, so the
    // fixtures decide. Statements are adjacent siblings with no punctuation
    // between them, so this rule does fire where the invalid case says.
    await sgRule(
      "sib",
      "rule:\n  kind: expression_statement\n  has:\n    kind: call_expression\n" +
        '    has: { field: function, kind: identifier, regex: "^eval$" }\n' +
        "  follows: { kind: expression_statement }\n"
    );
    await rm(join(cwd, ".taskless", "rules", "sg", "sib", "tests"), {
      recursive: true,
    });
    await fixtureCase("sib", "pass", "eval-alone", "eval(x);\n");
    await fixtureCase("sib", "fail", "eval-after-call", "a();\neval(x);\n");
    const { rules } = await report("verify", ".taskless/rules/sg/sib");
    expect(rules[0]?.errors).toEqual([]);
    expect(rules[0]?.ok).toBe(true);
    expect(rules[0]?.notices.some((notice) => notice.includes("stopBy"))).toBe(
      true
    );
  });
});
