/**
 * The demonstration rules' identities and file lists, with no imports at all.
 *
 * Separate from `rule.ts` because that module embeds the file CONTENTS through
 * vite's `?raw`, which only resolves under a vite transform. A plain Node
 * script — the reference-payload generator — cannot import it, and neither can
 * anything else outside the bundle.
 *
 * The paths therefore live here, stated once. `rule.ts` embeds exactly these
 * lists, the generator reads exactly these lists off disk, and
 * `test/demo-reference.test.ts` asserts the two agree — so the rules the CLI
 * writes and the payload handed to other teams cannot come to describe
 * different things.
 *
 * ## Why there are three
 *
 * One per engine, and each subject is chosen so the sample demonstrates its own
 * TIER rather than merely being a rule. `sg` decides from one expression in one
 * file. `vale` reads prose. `runtime` needs two files at once and so cannot be
 * either of the others. Run in order they answer the question a single sample
 * cannot: why there are three tiers at all.
 */

import type { EngineName } from "../layout";

/** One shipped demonstration rule. */
export interface DemoManifest {
  engine: EngineName;
  /**
   * The rule's directory name, and the id `check` and `test` address it by.
   *
   * Fixed, with no batch suffix. A generated rule carries one so a
   * regeneration does not collide with what is already there; these are
   * written from constant bytes, so writing one twice would be the same rule.
   */
  ruleId: string;
  /**
   * The generation request this rule is the answer to, as a caller would phrase
   * it. Lives beside the rule but is NEVER written into a project.
   *
   * Published so another team can generate from the same input and compare.
   * Without it a reference payload shows what we produced and not what we were
   * asked, which is the half an eval actually needs.
   */
  promptPath: string;
  /**
   * The rule itself: what a generator has to produce.
   *
   * Split from {@link testPaths} because the four-way conformance check needs
   * them apart — "run their rule against our cases" and "run our rule against
   * their cases" are both impossible from one flat list, since nothing in it
   * says which files are the claim and which are the oracle.
   */
  rulePaths: readonly string[];
  /**
   * The held-out cases both sides' rules must satisfy.
   *
   * Held out on purpose: the prompt carries its own illustrative examples for a
   * model to read, and these are different instances of the same subject. A
   * rule graded on the examples it was generated from is graded on nothing.
   *
   * Listed rather than globbed. Several are dot-paths — under `.tests/`, or
   * named `.env` — and glob helpers skip those by default, so a glob would
   * embed the rule file and silently omit every case. That produces a rule that
   * writes, verifies, and has nothing to prove, which is the exact failure
   * these runners exist to catch.
   */
  testPaths: readonly string[];
  /** The asset directory the files are read from, relative to `assets/`. */
  assetDirectory: string;
}

export const DEMO_MANIFESTS: readonly DemoManifest[] = [
  {
    engine: "sg",
    ruleId: "no-eval-call",
    assetDirectory: "demo-sg",
    promptPath: "prompt.md",
    rulePaths: ["no-eval-call.yml"],
    testPaths: [".tests/no-eval-call-test.yml"],
  },
  {
    engine: "vale",
    ruleId: "prefer-use-over-utilize",
    assetDirectory: "demo-vale",
    promptPath: "prompt.md",
    // `.vale.ini` is the rule's own engine config, so it is part of what a
    // generator must produce rather than part of the oracle.
    rulePaths: ["prefer-use-over-utilize.yml", ".vale.ini"],
    testPaths: [".tests/pass/README.md", ".tests/fail/README.md"],
  },
  {
    engine: "runtime",
    ruleId: "env-keys-declared",
    assetDirectory: "demo-runtime",
    promptPath: "prompt.md",
    rulePaths: ["check.ts", "captures/env-read.yml"],
    testPaths: [
      ".tests/pass/declared/src/config.ts",
      ".tests/pass/declared/.env",
      ".tests/fail/undeclared/src/config.ts",
      ".tests/fail/undeclared/.env",
    ],
  },
];

/** Every file written into a project: the rule and its cases, never the prompt. */
export function writtenPaths(manifest: DemoManifest): readonly string[] {
  return [...manifest.rulePaths, ...manifest.testPaths];
}

/** The manifest for one engine, or `undefined` if that engine ships no demo. */
export function demoManifestFor(engine: string): DemoManifest | undefined {
  return DEMO_MANIFESTS.find((manifest) => manifest.engine === engine);
}
