/**
 * The rules behind the conformance corpus: their identities,
 * their file lists, and the one reader that loads them off disk.
 *
 * Nothing in the bundle imports this. The rules used to be written into a
 * project by `taskless demo`; that command is gone, and what remains is the
 * corpus published as `@taskless/cli/reference.json`. The generator script and
 * `test/reference.test.ts` both build that payload through
 * {@link readReferenceInputs}, so "the committed file is current" is a
 * comparison against a fresh regeneration rather than against a second copy of
 * the lists.
 *
 * ## Why there are three
 *
 * One per engine, and each subject is chosen so the sample demonstrates its own
 * TIER rather than merely being a rule. `sg` decides from one expression in one
 * file. `vale` reads prose. `runtime` needs two files at once and so cannot be
 * either of the others. Run in order they answer the question a single sample
 * cannot: why there are three tiers at all.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { EngineName } from "../layout";
import type { ReferenceInput } from "../reference";

/** One rule in the conformance corpus. */
export interface CorpusManifest {
  engine: EngineName;
  /**
   * The rule's directory name, and the id `check` and `verify` address it by.
   *
   * Fixed, with no batch suffix. A generated rule carries one so a
   * regeneration does not collide with what is already there; these are
   * constant bytes, so there is nothing to collide with.
   */
  ruleId: string;
  /**
   * The generation request this rule is the answer to, as a caller would phrase
   * it. Lives beside the rule but is never part of the staged rule tree.
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
   * Listed rather than globbed. Some are dot-paths, such as `.env`, and glob
   * helpers skip those by default, so a glob would
   * embed the rule file and silently omit every case. That produces a rule that
   * writes, validates, and has nothing to prove, which is the exact failure
   * these runners exist to catch.
   */
  testPaths: readonly string[];
  /** The asset directory the files are read from, relative to `assets/`. */
  assetDirectory: string;
}

export const CORPUS_MANIFESTS: readonly CorpusManifest[] = [
  {
    engine: "sg",
    ruleId: "no-eval-call",
    assetDirectory: "reference-sg",
    promptPath: "prompt.md",
    rulePaths: ["no-eval-call.yml"],
    testPaths: [
      "tests/pass/json-parse/payload.ts",
      "tests/fail/eval-call/payload.ts",
      "tests/fail/eval-no-args/payload.ts",
      "tests/fail/eval-multiple-args/payload.ts",
    ],
  },
  {
    engine: "vale",
    ruleId: "prefer-use-over-utilize",
    assetDirectory: "reference-vale",
    promptPath: "prompt.md",
    // `.vale.ini` is the rule's own engine config, so it is part of what a
    // generator must produce rather than part of the oracle.
    rulePaths: ["prefer-use-over-utilize.yml", ".vale.ini"],
    testPaths: [
      "tests/pass/use-in-prose/README.md",
      "tests/fail/utilize-in-prose/README.md",
      "tests/fail/utilized-past/README.md",
      "tests/fail/utilization-noun/README.md",
    ],
  },
  {
    engine: "runtime",
    ruleId: "env-keys-declared",
    assetDirectory: "reference-runtime",
    promptPath: "prompt.md",
    rulePaths: ["check.ts", "captures/env-read.yml"],
    testPaths: [
      "tests/pass/declared/src/config.ts",
      "tests/pass/declared/.env",
      "tests/fail/undeclared/src/config.ts",
      "tests/fail/undeclared/.env",
    ],
  },
];

/** Every file of the staged rule tree: the rule and its cases, never the prompt. */
export function writtenPaths(manifest: CorpusManifest): readonly string[] {
  return [...manifest.rulePaths, ...manifest.testPaths];
}

/** Every manifest's prompt, rule and cases, read from `assetsRoot`. */
export async function readReferenceInputs(
  assetsRoot: string
): Promise<ReferenceInput[]> {
  const read = (assetDirectory: string, path: string) =>
    readFile(join(assetsRoot, assetDirectory, path), "utf8");
  const readAll = (assetDirectory: string, paths: readonly string[]) =>
    Promise.all(
      paths.map(async (path) => ({
        path,
        content: await read(assetDirectory, path),
      }))
    );

  return Promise.all(
    CORPUS_MANIFESTS.map(async (manifest) => ({
      engine: manifest.engine,
      ruleId: manifest.ruleId,
      prompt: await read(manifest.assetDirectory, manifest.promptPath),
      ruleFiles: await readAll(manifest.assetDirectory, manifest.rulePaths),
      testFiles: await readAll(manifest.assetDirectory, manifest.testPaths),
    }))
  );
}
