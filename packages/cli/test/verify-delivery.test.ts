import { describe, expect, it } from "vitest";

import type { ServedRule } from "../src/api/v2";
import { verifyServedRule } from "../src/rules/verify-delivery";
import { servedBody, type StubRule } from "./support/v2-server";

const SG: StubRule = {
  id: "no-eval-3fa9c21b",
  engine: "sg",
  files: [
    { path: "no-eval-3fa9c21b.yml", content: "id: no-eval-3fa9c21b\n" },
    { path: ".tests/fail/case.ts", content: "eval(x);\n" },
  ],
};

const RUNTIME: StubRule = {
  id: "no-env-leak-00000000",
  engine: "runtime",
  files: [
    { path: "check.ts", content: "export default async () => [];\n" },
    { path: "captures/env.yml", content: "id: env\n" },
  ],
};

async function served(
  rule: StubRule,
  mutate: (body: {
    ruleId: string;
    revisionId: string;
    rules: Array<{
      id: string;
      files: Array<{ path: string; content: string }>;
      signatures: Array<{ path: string; signature: string }>;
      signature?: string;
    }>;
  }) => void = () => {}
): Promise<ServedRule> {
  const body = (await servedBody(rule, "rev-1")) as Parameters<
    typeof mutate
  >[0];
  mutate(body);
  return body as unknown as ServedRule;
}

describe("verifyServedRule", () => {
  it("accepts a correctly signed set, fixtures unsigned", async () => {
    const verdict = await verifyServedRule(await served(SG), {
      ruleId: SG.id,
      revisionId: "rev-1",
    });
    expect(verdict).toMatchObject({ ok: true, revisionId: "rev-1" });
  });

  it("accepts a runtime set whose signature equals its check.ts entry", async () => {
    const verdict = await verifyServedRule(await served(RUNTIME), {
      ruleId: RUNTIME.id,
    });
    expect(verdict.ok).toBe(true);
  });

  it.each([
    [
      "a file whose bytes do not match its signature",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.files[0]!.content = "id: tampered\n";
      },
      "do not match its signature",
    ],
    [
      "a file with no signature",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.signatures = [];
      },
      "with no signature",
    ],
    [
      "a signature naming no file",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.signatures.push({ path: "ghost.yml", signature: "x" });
      },
      "no such file",
    ],
    [
      "a signed fixture",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.signatures.push({
          path: ".tests/fail/case.ts",
          signature: "x",
        });
      },
      "fixtures are never signed",
    ],
    [
      "two signatures for one path",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.signatures.push({ ...body.rules[0]!.signatures[0]! });
      },
      "two signatures",
    ],
    [
      "more than one file set",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules.push({ ...body.rules[0]! });
      },
      "exactly one is expected",
    ],
    [
      "a file set for another rule",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.rules[0]!.id = "someone-else-00000000";
      },
      "file set for someone-else",
    ],
    [
      "an answer for another rule",
      (body: Parameters<Parameters<typeof served>[1] & object>[0]) => {
        body.ruleId = "someone-else-00000000";
      },
      "answered for rule someone-else",
    ],
  ])("refuses %s", async (_, mutate, reason) => {
    const verdict = await verifyServedRule(await served(SG, mutate), {
      ruleId: SG.id,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.reason).toContain(reason);
  });

  it("refuses a revision other than the one expected", async () => {
    const verdict = await verifyServedRule(await served(SG), {
      ruleId: SG.id,
      revisionId: "rev-0",
    });
    expect(verdict.ok ? "" : verdict.reason).toContain("not rev-0");
  });

  it("refuses a runtime set whose signature is not its check.ts entry", async () => {
    const verdict = await verifyServedRule(
      await served(RUNTIME, (body) => {
        body.rules[0]!.signature = body.rules[0]!.signatures.find(
          (entry) => entry.path === "captures/env.yml"
        )!.signature;
      }),
      { ruleId: RUNTIME.id }
    );
    expect(verdict.ok ? "" : verdict.reason).toContain("check.ts entry");
  });
});

describe("verifyServedRule: a malformed set is named by its field", () => {
  it.each([
    ["files is not an array", { files: "x" }, "`files` that is not an array"],
    [
      "an entry is not an object",
      { files: [1] },
      "`files[0]` that is not an object",
    ],
    [
      "an entry has no path",
      { files: [{ content: "" }] },
      "`files[0]` with no string `path`",
    ],
    [
      "an entry has no content",
      { files: [{ path: "a.yml" }] },
      "`a.yml` with no string `content`",
    ],
    [
      "signatures is not an array",
      { signatures: null },
      "`signatures` that is not an array",
    ],
    ["an engine is missing", { engine: undefined }, "no string `engine`"],
  ])("refuses a set where %s", async (_, patch, reason) => {
    const body = (await servedBody(SG, "rev-1")) as unknown as {
      rules: Record<string, unknown>[];
    };
    Object.assign(body.rules[0]!, patch);
    const verdict = await verifyServedRule(body as unknown as ServedRule, {
      ruleId: SG.id,
    });
    expect(verdict.ok ? "" : verdict.reason).toContain(reason);
  });
});
