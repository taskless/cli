import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSignature } from "../src/rules/rule-hash";
import { buildReference, type Reference } from "../src/rules/reference";
import { RULE_CONSTRAINTS } from "../src/rules/constraints";
import { DEMO_MANIFESTS, writtenPaths } from "../src/rules/demo/manifest";
import { ENGINE_LAYOUTS, ENGINES } from "../src/rules/layout";
import { ruleDirectory } from "../src/rules/engines";
import { DEMO_RULES } from "../src/rules/demo/rule";

/**
 * The reference payload other teams consume, and the rules we ship, describe
 * the same thing.
 *
 * Two lists exist because `?raw` only resolves under a vite transform, so the
 * generator script reads the assets off disk while the bundle embeds them.
 * Nothing stops those from drifting except this file.
 */

const referencePath = join(
  import.meta.dirname,
  "..",
  "assets",
  "reference.json"
);

async function readReference(): Promise<Reference> {
  return JSON.parse(await readFile(referencePath, "utf8")) as Reference;
}

function ruleFor(reference: Reference, engine: string) {
  const rule = reference.rules.find((entry) => entry.engine === engine);
  if (rule === undefined) throw new Error(`reference has no ${engine} rule`);
  return rule;
}

describe("the demo reference payload", () => {
  it("is current — regenerate with `pnpm --filter @taskless/cli reference`", async () => {
    expect(await readReference()).toEqual(buildReference(DEMO_RULES));
  });

  it("embeds exactly the files each manifest lists", () => {
    for (const manifest of DEMO_MANIFESTS) {
      const rule = DEMO_RULES.find((entry) => entry.engine === manifest.engine);
      expect(rule?.ruleFiles.map((file) => file.path)).toEqual([
        ...manifest.rulePaths,
      ]);
      expect(rule?.testFiles.map((file) => file.path)).toEqual([
        ...manifest.testPaths,
      ]);
    }
  });

  it("names every dot-path explicitly, because a glob would drop them", () => {
    // The regression this replaces was specific: a switch to glob-based path
    // discovery embeds the rule file and silently omits every dot-path case,
    // producing a rule that writes, verifies, and has nothing to prove. The
    // test that caught it asserted particular paths, so this one does too --
    // iterating whatever the manifest happens to hold would pass trivially
    // over a shrunken list, which is exactly the failure being guarded.
    const required: Record<string, readonly string[]> = {
      sg: [".tests/no-eval-call-test.yml"],
      vale: [".vale.ini", ".tests/pass/README.md", ".tests/fail/README.md"],
      runtime: [".tests/pass/declared/.env", ".tests/fail/undeclared/.env"],
    };

    // A fourth sample has to be added here as well as to the manifest. That is
    // the point: whoever adds it states which of its files are dot-paths,
    // rather than inheriting a guard that silently covers nothing.
    expect(
      DEMO_MANIFESTS.map((manifest) => manifest.engine).toSorted()
    ).toEqual(Object.keys(required).toSorted());

    for (const manifest of DEMO_MANIFESTS) {
      const written = writtenPaths(manifest);
      for (const path of required[manifest.engine] ?? []) {
        expect(written, `${manifest.engine} no longer lists ${path}`).toContain(
          path
        );
      }
    }
  });

  it("carries one rule per engine", async () => {
    const reference = await readReference();
    const engines = reference.rules.map((rule) => rule.engine);
    expect(engines.toSorted()).toEqual(["runtime", "sg", "vale"]);
  });

  it("signs only the runtime rule, because only it is gated", async () => {
    const reference = await readReference();

    // Well-formed on purpose. A malformed signature would be refused by the
    // parser, which exercises the wrong half of the gate — the half worth
    // demonstrating is the COMPARISON, which a parseable-but-wrong value
    // reaches.
    const parsed = parseSignature(
      ruleFor(reference, "runtime").signature ?? ""
    );
    expect(parsed.algoVersion).toBe(1);
    expect(parsed.algo).toBe("sha-256");
    // All zeros, so it can never be mistaken for a blessed signature or lifted
    // out of the file into something that would run.
    expect(parsed.digest).toBe("0".repeat(64));

    // `sg` and `vale` are inert data. A signature on them would imply a gate
    // that does not exist.
    expect(ruleFor(reference, "sg").signature).toBeUndefined();
    expect(ruleFor(reference, "vale").signature).toBeUndefined();
  });

  it("keeps the rule and the cases apart, which is what the cross needs", async () => {
    const reference = await readReference();
    for (const rule of reference.rules) {
      expect(
        rule.rule.length,
        `${rule.id} carries no rule files`
      ).toBeGreaterThan(0);
      expect(
        rule.tests.files.length,
        `${rule.id} carries no cases`
      ).toBeGreaterThan(0);

      // If a case leaked into `rule`, "run their rule against our cases" would
      // hand over our answers along with the question, and the cross would
      // measure nothing.
      const rulePaths = new Set(rule.rule.map((file) => file.path));
      for (const test of rule.tests.files) {
        expect(rulePaths.has(test.path), `${test.path} is in both halves`).toBe(
          false
        );
        expect(test.path.startsWith(".tests/")).toBe(true);
      }
      for (const file of rule.rule) {
        expect(file.path.startsWith(".tests/")).toBe(false);
      }
    }
  });

  it("says how its fixtures group, so nobody re-derives it from paths", async () => {
    const reference = await readReference();

    // The defect this shape exists to prevent, stated as the assertion that
    // would have caught it. The Cloud eval team's request format carried one
    // anonymous blob per case, so this two-file case arrived as two one-file
    // cases and the rule was graded against half of itself (#263).
    const runtime = ruleFor(reference, "runtime");
    expect(runtime.tests.grouping).toBe("case-directories");
    const failing = runtime.tests.cases?.filter((one) => one.bucket === "fail");
    expect(failing).toHaveLength(1);
    expect(failing?.[0]?.path).toBe(".tests/fail/undeclared");
    expect(failing?.[0]?.files.toSorted()).toEqual([
      ".tests/fail/undeclared/.env",
      ".tests/fail/undeclared/src/config.ts",
    ]);

    // A vale case is the document, not the bucket it sits in.
    const vale = ruleFor(reference, "vale");
    expect(vale.tests.grouping).toBe("case-documents");
    for (const one of vale.tests.cases ?? []) {
      expect(one.files).toEqual([one.path]);
    }
  });

  it("publishes no cases for ast-grep, and that absence is the statement", async () => {
    const reference = await readReference();
    const sg = ruleFor(reference, "sg");

    // Not an omission. The grouping is inside ast-grep's own test file, in a
    // schema ast-grep documents and owns. Restating it here would be a copy
    // this repository would then have to keep true.
    expect(sg.tests.grouping).toBe("ast-grep-test");
    expect(sg.tests.cases).toBeUndefined();
    expect(sg.tests.files).toHaveLength(1);
  });

  it("names every case file exactly once, and names no file it does not carry", async () => {
    const reference = await readReference();
    for (const rule of reference.rules) {
      if (rule.tests.cases === undefined) continue;
      const carried = new Set(rule.tests.files.map((file) => file.path));
      const named = rule.tests.cases.flatMap((one) => one.files);

      // A case naming a path the corpus does not carry is a case a consumer
      // cannot materialize, and it would read as a fixture we forgot to ship.
      for (const path of named) {
        expect(carried.has(path), `${rule.id}: case names absent ${path}`).toBe(
          true
        );
      }
      // And the other direction: a fixture in no case is one that silently
      // never runs, which is the failure the runners exist to catch.
      expect(named.toSorted()).toEqual([...carried].toSorted());
    }
  });

  it("names the tree its paths are relative to", async () => {
    const reference = await readReference();

    // Without this the corpus is a set of paths with no stated root, and a
    // consumer materializing a rule has to assume where the CLI looks.
    expect(reference.layout.rulesRoot).toBe(".taskless/rules");
    expect(reference.layout.ruleDirectory).toBe(
      ".taskless/rules/{engine}/{id}"
    );
    expect(reference.layout.testsDirectory).toBe(".tests");

    // Generated from the table the CLI dispatches on, so it cannot describe a
    // layout the CLI does not implement.
    for (const engine of ENGINES) {
      const published = reference.layout.engines[engine];
      const layout = ENGINE_LAYOUTS[engine];
      expect(published.ruleFile).toBe(layout.ruleFile("{id}"));
      expect(published.ruleConfigFile).toBe(layout.ruleConfigFile ?? null);
      expect(published.capturesDirectory).toBe(
        layout.capturesDirectory ?? null
      );
      expect(published.fixtureLayout).toBe(layout.fixtureLayout);
    }
  });

  it("resolves each rule's directory the way the CLI resolves it", async () => {
    const reference = await readReference();
    for (const rule of reference.rules) {
      // Against the resolver the commands use, not against a second copy of
      // the pattern -- a template and a published path that agree with each
      // other but not with `verify` would pass a weaker test.
      expect(ruleDirectory("", rule.engine, rule.id).split(sep).join("/")).toBe(
        rule.directory
      );
      expect(rule.ruleFile).toBe(ENGINE_LAYOUTS[rule.engine].ruleFile(rule.id));
      expect(rule.rule.map((file) => file.path)).toContain(rule.ruleFile);
    }
  });

  it("states a version a consumer can refuse on", async () => {
    const reference = await readReference();
    // 2 is `tests` becoming an object and `layout` arriving. A consumer that
    // asserts this and stops is behaving correctly, which is what makes the
    // bump a sufficient signal on its own.
    expect(reference.version).toBe(2);
  });

  it("carries the prompt each rule answers", async () => {
    const reference = await readReference();
    for (const rule of reference.rules) {
      expect(rule.prompt.length, `${rule.id} has no prompt`).toBeGreaterThan(
        80
      );
    }
  });

  it("publishes the constraints a generator could not otherwise know", async () => {
    const reference = await readReference();
    expect(reference.constraints.map((c) => c.id).toSorted()).toEqual(
      RULE_CONSTRAINTS.map((c) => c.id).toSorted()
    );
    // `enforcedBy` decides the order a consumer's eval has to run in, so it
    // travels with each entry rather than being implied by the protocol text.
    for (const constraint of reference.constraints) {
      expect(["verify", "test"]).toContain(constraint.enforcedBy);
    }
  });

  it("states its own protocol, including the verify step", async () => {
    const reference = await readReference();
    expect(reference.protocol.length).toBeGreaterThanOrEqual(5);
    expect(reference.protocol.join("\n")).toContain("taskless verify");
  });
});

describe("the reference payload is reachable by another team", () => {
  it("is a published export, not just a repository file", async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { files: string[]; exports: Record<string, unknown> };

    // Both halves are needed and neither implies the other: `exports` without
    // `files` names a path npm does not ship, and `files` without `exports` is
    // unreachable under this package's strict export map.
    expect(manifest.files).toContain("assets/reference.json");
    expect(manifest.exports["./reference.json"]).toBe(
      "./assets/reference.json"
    );
  });
});
