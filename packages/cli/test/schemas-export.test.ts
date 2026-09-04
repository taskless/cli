import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const distributionDirectory = resolve(import.meta.dirname, "../dist");
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
  "verifyTestOutputSchema",
] as const;

interface ParsedSchema {
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => { success: boolean };
}

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-schemas-"));
  await execFileAsync("node", [binPath, "init", "--no-interactive", "-d", cwd]);
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
    const directory = join(cwd, ".taskless", "rules", "sg", "probe-rule");
    await mkdir(join(directory, ".tests"), { recursive: true });
    await writeFile(
      join(directory, "probe-rule.yml"),
      "id: probe-rule\nlanguage: TypeScript\nseverity: error\n" +
        "message: no eval\nrule:\n  pattern: eval($ARG)\n"
    );
    await writeFile(
      join(directory, ".tests", "probe-rule-test.yml"),
      "id: probe-rule\nvalid:\n  - const a = 1;\ninvalid:\n  - eval(x);\n"
    );

    const { stdout } = await execFileAsync("node", [
      binPath,
      "verify",
      "-d",
      cwd,
      "--json",
    ]);

    const built = await importBuiltSchemas();
    const schema = built.verifyTestOutputSchema as ParsedSchema;
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

  it("strips what it does not declare, which a JSON Schema of the same shape would not", async () => {
    // The reason this entry publishes zod rather than a rendering of it. A
    // JSON Schema validator hands back the object it was given, unknown keys
    // and all; `parse()` returns only the declared fields, so a consumer
    // cannot come to depend on a field we never promised.
    const built = await importBuiltSchemas();
    const schema = built.verifyTestOutputSchema as ParsedSchema;
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
    const schema = built.verifyTestOutputSchema as ParsedSchema;
    expect(schema.safeParse({ ok: true }).success).toBe(false);
    expect(
      schema.safeParse({ ok: true, rules: [{ engine: "sg" }] }).success
    ).toBe(false);
  });
});
