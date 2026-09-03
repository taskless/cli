import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSignature } from "../src/rules/rule-hash";
import { buildDemoReference } from "../src/rules/demo/reference";
import { DEMO_RUNTIME_PATHS } from "../src/rules/demo/manifest";
import {
  DEMO_RUNTIME_FILES,
  DEMO_RUNTIME_RULE_ID,
} from "../src/rules/demo/rule";

/**
 * The reference payload we hand the generator team, and the rule we ship,
 * describe the same thing.
 *
 * Two lists exist because `?raw` only resolves under a vite transform, so the
 * generator script reads the assets off disk while the bundle embeds them.
 * Nothing stops those from drifting except this file.
 */

const referencePath = join(
  import.meta.dirname,
  "..",
  "assets",
  "demo-runtime-reference.json"
);

async function readReference(): Promise<ReturnType<typeof buildDemoReference>> {
  return JSON.parse(await readFile(referencePath, "utf8")) as ReturnType<
    typeof buildDemoReference
  >;
}

/**
 * The one rule the reference carries.
 *
 * A helper rather than a destructure: the payload's `rules` is an array
 * because the retrieval shape allows several, and asserting there is exactly
 * one here is a claim worth making rather than an index worth trusting.
 */
function onlyRule(
  reference: ReturnType<typeof buildDemoReference>
): ReturnType<typeof buildDemoReference>["rules"][number] {
  expect(reference.rules).toHaveLength(1);
  const [rule] = reference.rules;
  if (rule === undefined) throw new Error("reference carries no rule");
  return rule;
}

describe("the demo reference payload", () => {
  it("is current — regenerate with `pnpm --filter @taskless/cli demo:reference`", async () => {
    const expected = buildDemoReference(
      DEMO_RUNTIME_RULE_ID,
      DEMO_RUNTIME_FILES
    );
    expect(await readReference()).toEqual(expected);
  });

  it("embeds exactly the files the manifest lists", () => {
    expect(DEMO_RUNTIME_FILES.map((file) => file.path)).toEqual([
      ...DEMO_RUNTIME_PATHS,
    ]);
  });

  it("carries a signature that parses and is not a real digest", async () => {
    const rule = onlyRule(await readReference());

    // Well-formed on purpose. A malformed signature would be refused by the
    // parser, which exercises the wrong half of the gate — the half worth
    // demonstrating is the COMPARISON, which a parseable-but-wrong value
    // reaches.
    const parsed = parseSignature(rule.signature);
    expect(parsed.algoVersion).toBe(1);
    expect(parsed.algo).toBe("sha-256");

    // All zeros, so it can never be mistaken for a blessed signature or lifted
    // out of the file into something that would run.
    expect(parsed.digest).toBe("0".repeat(64));
  });

  it("declares the runtime engine, which is what makes the signature required", async () => {
    const rule = onlyRule(await readReference());
    expect(rule.engine).toBe("runtime");
    expect(rule.id).toBe(DEMO_RUNTIME_RULE_ID);
  });
});
