/**
 * The demonstration rules, embedded from `assets/demo-*`.
 *
 * ## Why these ship rather than being generated
 *
 * The demonstration used to be fetched from a service endpoint, so that it
 * exercised the same generation path a real request does. That reasoning was
 * sound about generation and wrong about what the demonstration is for: it made
 * a demonstration of the TIER depend on a demonstration of GENERATION, and
 * every failure mode of the second became a failure mode of the first.
 *
 * It was not hypothetical. The served rule arrived classified as `sg` — a tier
 * whose evidence fits in one file — although the fixture behind it exists
 * precisely because its subject spans two. Its two-file passing example reached
 * the client with the second file deleted, at which point it matched the
 * single-file pattern it had been flattened into, and the rule failed
 * `taskless test` on arrival.
 *
 * A rule that ships cannot arrive mis-tiered, flattened, or with an id its body
 * does not match, because CI runs `taskless test` over these exact bytes.
 *
 * ## Why the imports are written out
 *
 * `?raw` is a vite transform, so the specifiers must be literals it can see at
 * build time — `import.meta.glob` would skip the dot-paths, and a computed
 * specifier would not be transformed at all. `manifest.ts` holds the lists;
 * this module is where each entry acquires its bytes.
 */

import sgPrompt from "../../../assets/demo-sg/prompt.md?raw";
import sgRule from "../../../assets/demo-sg/no-eval-call.yml?raw";
import sgTest from "../../../assets/demo-sg/.tests/no-eval-call-test.yml?raw";

import valePrompt from "../../../assets/demo-vale/prompt.md?raw";
import valeRule from "../../../assets/demo-vale/prefer-use-over-utilize.yml?raw";
import valeConfig from "../../../assets/demo-vale/.vale.ini?raw";
import valePass from "../../../assets/demo-vale/.tests/pass/README.md?raw";
import valeFail from "../../../assets/demo-vale/.tests/fail/README.md?raw";

import runtimePrompt from "../../../assets/demo-runtime/prompt.md?raw";
import captureEnvironmentRead from "../../../assets/demo-runtime/captures/env-read.yml?raw";
import checkSource from "../../../assets/demo-runtime/check.ts?raw";
import failEnvironment from "../../../assets/demo-runtime/.tests/fail/undeclared/.env?raw";
import failSource from "../../../assets/demo-runtime/.tests/fail/undeclared/src/config.ts?raw";
import passEnvironment from "../../../assets/demo-runtime/.tests/pass/declared/.env?raw";
import passSource from "../../../assets/demo-runtime/.tests/pass/declared/src/config.ts?raw";

import type { EngineName } from "../layout";
import type { DeliveredFile } from "../deliver";
import { DEMO_MANIFESTS, writtenPaths } from "./manifest";

export { DEMO_MANIFESTS, demoManifestFor, writtenPaths } from "./manifest";
export type { DemoManifest } from "./manifest";

/** One shipped demonstration rule, with the bytes of every file it contains. */
export interface DemoRule {
  engine: EngineName;
  ruleId: string;
  /** The generation request, published for conformance and never written. */
  prompt: string;
  /** The rule itself: what a generator has to produce. */
  ruleFiles: readonly DeliveredFile[];
  /** The held-out cases both sides' rules must satisfy. */
  testFiles: readonly DeliveredFile[];
  /**
   * Everything written into a project, rule and cases together.
   *
   * Deliberately the same `DeliveredFile[]` a served rule produces, so a demo
   * is written by `assessDelivery` + `writeDeliveredFileSet` rather than by a
   * second writer. If one ever needs its own writer, the shapes have diverged
   * and that is the finding.
   */
  files: readonly DeliveredFile[];
}

/** Contents by asset path, keyed exactly as `manifest.ts` lists them. */
const PROMPTS: Record<string, string> = {
  "demo-sg": sgPrompt,
  "demo-vale": valePrompt,
  "demo-runtime": runtimePrompt,
};

const CONTENTS: Record<string, Record<string, string>> = {
  "demo-sg": {
    "no-eval-call.yml": sgRule,
    ".tests/no-eval-call-test.yml": sgTest,
  },
  "demo-vale": {
    "prefer-use-over-utilize.yml": valeRule,
    ".vale.ini": valeConfig,
    ".tests/pass/README.md": valePass,
    ".tests/fail/README.md": valeFail,
  },
  "demo-runtime": {
    "check.ts": checkSource,
    "captures/env-read.yml": captureEnvironmentRead,
    ".tests/pass/declared/src/config.ts": passSource,
    ".tests/pass/declared/.env": passEnvironment,
    ".tests/fail/undeclared/src/config.ts": failSource,
    ".tests/fail/undeclared/.env": failEnvironment,
  },
};

/**
 * Every shipped demonstration rule.
 *
 * Built by walking the manifests rather than by restating them, so a path added
 * to a manifest without a matching embed throws HERE, at module load, rather
 * than producing a rule that writes one file fewer than it should.
 */
function embed(assetDirectory: string, ruleId: string) {
  return (path: string): DeliveredFile => {
    const content = CONTENTS[assetDirectory]?.[path];
    if (content === undefined) {
      throw new Error(
        `demo rule ${ruleId} lists ${path} in its manifest but nothing embeds it`
      );
    }
    return { path, content };
  };
}

export const DEMO_RULES: readonly DemoRule[] = DEMO_MANIFESTS.map(
  (manifest) => {
    const bytes = embed(manifest.assetDirectory, manifest.ruleId);
    const prompt = PROMPTS[manifest.assetDirectory];
    if (prompt === undefined) {
      throw new Error(`demo rule ${manifest.ruleId} embeds no prompt`);
    }
    return {
      engine: manifest.engine,
      ruleId: manifest.ruleId,
      prompt,
      ruleFiles: manifest.rulePaths.map((path) => bytes(path)),
      testFiles: manifest.testPaths.map((path) => bytes(path)),
      files: writtenPaths(manifest).map((path) => bytes(path)),
    };
  }
);

/** The shipped demonstration rule for one engine, if there is one. */
export function demoRuleFor(engine: string): DemoRule | undefined {
  return DEMO_RULES.find((rule) => rule.engine === engine);
}
