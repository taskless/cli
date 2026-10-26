import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyRule } from "../src/rules/verify";
import { findValeBinary } from "../src/rules/vale/binary";
import { verifyValeRule } from "../src/rules/vale/verify";
import { builtDirectory } from "./support/built-cli";

const execFileAsync = promisify(execFile);

const distributionDirectory = builtDirectory();
const distributionSchemasPath = resolve(distributionDirectory, "schemas.js");
const binPath = resolve(distributionDirectory, "index.js");

/**
 * The published `@taskless/cli/schemas` entry.
 *
 * The BUILT entry, the way a consumer imports it. Its whole purpose is that a
 * consumer stops hand-writing an interface for our `--json` output, so the
 * question worth asking is whether the artifact a consumer receives can parse
 * what the CLI a consumer runs actually emits.
 */
async function importBuiltSchemas(): Promise<Record<string, unknown>> {
  const url = pathToFileURL(distributionSchemasPath).href;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

/**
 * The exact public surface. Hand-maintained, for `PUBLIC_EXPORTS`'s reason in
 * `layout.test.ts`: this entry re-exports from modules the CLI also uses
 * internally, so a schema added there for internal reasons would otherwise
 * become public API by sharing a directory with the ones that are.
 *
 * Type-only exports do not appear here — they are erased — which is why
 * `CLIErrorCode` and the constraint types are absent from a list that names
 * them in the source.
 */
const PUBLIC_EXPORTS = [
  "valeVerifyOutputSchema",
  "verifyOutputSchema",
  "ruleCheckOutputSchema",
] as const;

interface ParsedSchema {
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => { success: boolean };
}

let cwd: string;

/** An ast-grep rule with one `pass/` and one `fail/` case directory. */
async function sgProbe(id: string): Promise<void> {
  const directory = join(cwd, ".taskless", "rules", "sg", id);
  await mkdir(join(directory, "tests", "pass", "clean"), { recursive: true });
  await mkdir(join(directory, "tests", "fail", "dirty"), { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `id: ${id}\nlanguage: TypeScript\nseverity: error\n` +
      "message: no eval\nrule:\n  pattern: eval($ARG)\n"
  );
  await writeFile(
    join(directory, "tests", "pass", "clean", "clean.ts"),
    "const a = 1;\n"
  );
  await writeFile(
    join(directory, "tests", "fail", "dirty", "dirty.ts"),
    "eval(x);\n"
  );
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-schemas-"));
  await execFileAsync("node", [binPath, "init", "-d", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("the published schemas entry", () => {
  it("exports exactly the promised surface", async () => {
    const built = await importBuiltSchemas();
    expect(Object.keys(built).toSorted()).toEqual(
      [...PUBLIC_EXPORTS].toSorted()
    );
  });

  it("parses what the CLI actually emits", async () => {
    // The claim this entry exists to make, tested against both halves of it:
    // the built schema, and the built CLI's real output. A test that parsed a
    // hand-written fixture would prove the schema parses the fixture.
    await sgProbe("probe-rule");

    const { stdout } = await execFileAsync("node", [
      binPath,
      "validate",
      "-d",
      cwd,
      "--json",
    ]);

    const built = await importBuiltSchemas();
    const schema = built.ruleCheckOutputSchema as ParsedSchema;
    const parsed = schema.parse(JSON.parse(stdout)) as {
      ok: boolean;
      rules: { ruleId: string; violations: unknown[] }[];
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.rules[0]?.ruleId).toBe("probe-rule");
    // `violations` survives the round trip, which is the field a consumer came
    // for. A schema that silently dropped it would still "parse" the output.
    expect(parsed.rules[0]?.violations).toEqual([]);
  });

  it("parses what verify actually emits, fixture findings included", async () => {
    // `validate` runs no fixtures, so the test above only ever parses an empty
    // `findings`. This one runs the cases. ast-grep writes `"note": null` for a
    // rule without a `note:`, which the finding schema does not allow, so
    // `verify --json` over such a rule once printed a zod error instead of
    // JSON. The probe has no `note:` on purpose.
    await sgProbe("probe-rule");

    const { stdout } = await execFileAsync("node", [
      binPath,
      "verify",
      "-d",
      cwd,
      "--json",
    ]);

    const built = await importBuiltSchemas();
    const schema = built.ruleCheckOutputSchema as ParsedSchema;
    const parsed = schema.parse(JSON.parse(stdout)) as {
      ok: boolean;
      rules: {
        findings: { bucket: string; message: string; note?: unknown }[];
      }[];
    };

    expect(parsed.ok).toBe(true);
    const findings = parsed.rules[0]?.findings ?? [];
    expect(findings.map((finding) => finding.bucket)).toEqual(["fail"]);
    expect(findings[0]?.message).toBe("no eval");
    expect(findings[0]).not.toHaveProperty("note");
  });

  it("strips what it does not declare, which a JSON Schema of the same shape would not", async () => {
    // The reason this entry publishes zod rather than a rendering of it. A
    // JSON Schema validator hands back the object it was given, unknown keys
    // and all; `parse()` returns only the declared fields, so a consumer
    // cannot come to depend on a field we never promised.
    const built = await importBuiltSchemas();
    const schema = built.ruleCheckOutputSchema as ParsedSchema;
    expect(schema.parse({ ok: true, rules: [], surprise: 1 })).toEqual({
      ok: true,
      rules: [],
    });
  });

  it("fails loudly on output it does not describe", async () => {
    // The property that makes publishing the schema worth anything over a
    // hand-written interface: a shape it does not cover is refused rather than
    // yielding a partially-typed value the consumer goes on to use.
    const built = await importBuiltSchemas();
    const schema = built.ruleCheckOutputSchema as ParsedSchema;
    expect(schema.safeParse({ ok: true }).success).toBe(false);
    expect(
      schema.safeParse({ ok: true, rules: [{ engine: "sg" }] }).success
    ).toBe(false);
  });
});

/**
 * `verifyOutputSchema` and `valeVerifyOutputSchema` are the other half of the
 * bug this file exists to catch (issue #283): no command spawns to produce
 * their shape any more. `taskless rule verify <id> --json` printed exactly
 * this — `{ engine: "sg", ...verifyRule() }`, or the equivalent mapped
 * envelope over `verifyValeRule()` for Vale — until rule addressing moved
 * from id to path and `rule verify` was removed with it. See the docstrings
 * on these exports in `src/schemas/index.ts` for the full history.
 *
 * That means the "spawn the CLI, parse its stdout" pattern above cannot pin
 * these two: there is no invocation left that emits this shape. What CAN be
 * pinned, absent a command to spawn, is that the published schema still
 * parses the exact envelope the internal functions produce today — built the
 * same way the removed command built it. A future change to `verifyRule()` or
 * `verifyValeRule()` that drifts from what's published here fails a real
 * test, rather than staying invisible the way the id/path mismatch did.
 */
describe("verifyOutputSchema and valeVerifyOutputSchema", () => {
  it("verifyOutputSchema parses verifyRule()'s real return value for an sg rule", async () => {
    await sgProbe("schema-probe");

    // The exact envelope the removed command built: `{ engine: "sg", ...result }`.
    const result = await verifyRule(cwd, "schema-probe");

    const built = await importBuiltSchemas();
    const schema = built.verifyOutputSchema as ParsedSchema;
    const parsed = schema.parse({ engine: "sg", ...result }) as {
      success: boolean;
      ruleId: string;
      tests: {
        passed: number;
        failed: number;
        fixtures: string;
        findings: { bucket: string }[];
      };
    };

    expect(parsed.success).toBe(true);
    expect(parsed.ruleId).toBe("schema-probe");
    // One per case: the `pass/` case and the `fail/` case both behaved.
    expect(parsed.tests).toMatchObject({ passed: 2, failed: 0 });
    // Survived `parse()`, which strips what the schema does not declare, so
    // these assert the schema carries them rather than that the CLI does.
    expect(parsed.tests.fixtures).toBe("both");
    expect(parsed.tests.findings.map((finding) => finding.bucket)).toEqual([
      "fail",
    ]);
  });

  const withVale = findValeBinary().path === undefined ? it.skip : it;

  withVale(
    "valeVerifyOutputSchema parses the envelope built over verifyValeRule()'s real return value",
    async () => {
      const directory = join(
        cwd,
        ".taskless",
        "rules",
        "vale",
        "schema-probe-vale"
      );
      await mkdir(join(directory, "tests", "pass", "clean"), {
        recursive: true,
      });
      await mkdir(join(directory, "tests", "fail", "dirty"), {
        recursive: true,
      });
      await writeFile(
        join(directory, "schema-probe-vale.yml"),
        "extends: existence\nmessage: \"Avoid 'simply'\"\nlevel: warning\ntokens:\n  - simply\n"
      );
      // A case is judged under the rule's own matchers, so the rule needs them.
      await writeFile(
        join(directory, ".vale.ini"),
        "[*.md]\ntskl) rule = schema-probe-vale\nschema-probe-vale.schema-probe-vale = YES\n"
      );
      await writeFile(
        join(directory, "tests", "pass", "clean", "clean.md"),
        "Nothing objectionable.\n"
      );
      await writeFile(
        join(directory, "tests", "fail", "dirty", "dirty.md"),
        "Just simply do it.\n"
      );

      const result = await verifyValeRule(cwd, "schema-probe-vale");
      if ("outcome" in result) {
        throw new Error(
          `Vale did not run: ${result.outcome.status} — ${result.outcome.message}`
        );
      }

      // The exact mapping the removed command applied: `passed` -> `success`,
      // everything else carried straight through.
      const built = await importBuiltSchemas();
      const schema = built.valeVerifyOutputSchema as ParsedSchema;
      const parsed = schema.parse({
        engine: "vale",
        success: result.passed,
        ruleId: result.ruleId,
        fixtures: result.fixtures,
        findings: result.findings,
        missingFailures: result.missingFailures,
        unexpectedFindings: result.unexpectedFindings,
        errors: result.errors,
        notices: result.notices,
      }) as {
        success: boolean;
        ruleId: string;
        findings: { bucket: string; file: string }[];
      };

      expect(parsed.success).toBe(true);
      expect(parsed.ruleId).toBe("schema-probe-vale");
      // The rendered findings survive `parse()`, so the schema declares them.
      expect(parsed.findings).toEqual([
        expect.objectContaining({
          bucket: "fail",
          file: ".taskless/rules/vale/schema-probe-vale/tests/fail/dirty/dirty.md",
        }),
      ]);
    }
  );
});
