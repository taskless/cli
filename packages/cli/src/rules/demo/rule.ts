/**
 * The demonstration runtime rule, embedded from `assets/demo-runtime/`.
 *
 * ## Why this ships rather than being generated
 *
 * The demonstration used to be fetched from a service endpoint, so that it
 * exercised the same generation path a real request does. That reasoning was
 * sound about generation and wrong about what the demonstration is for: it made
 * a demonstration of the runtime TIER depend on a demonstration of GENERATION,
 * and every failure mode of the second became a failure mode of the first.
 *
 * It was not hypothetical. The served rule arrived classified as `sg` — a tier
 * whose evidence fits in one file — although the fixture behind it exists
 * precisely because this subject spans two. Its two-file passing example
 * reached the client with the second file deleted, at which point it matched
 * the single-file pattern it had been flattened into, and the rule failed
 * `taskless test` on arrival.
 *
 * A rule that ships cannot arrive mis-tiered, flattened, or with an id its body
 * does not match, because CI runs `taskless test` over these exact bytes.
 *
 * ## Why the imports are written out
 *
 * `?raw` is a vite transform, so the specifiers must be literals it can see at
 * build time — `import.meta.glob` would skip the dot-paths, and a computed
 * specifier would not be transformed at all. {@link DEMO_RUNTIME_PATHS} is the
 * list; this module is where each entry acquires its bytes.
 */

import captureEnvironmentRead from "../../../assets/demo-runtime/captures/env-read.yml?raw";
import checkSource from "../../../assets/demo-runtime/check.ts?raw";
import failEnvironment from "../../../assets/demo-runtime/.tests/fail/undeclared/.env?raw";
import failSource from "../../../assets/demo-runtime/.tests/fail/undeclared/src/config.ts?raw";
import passEnvironment from "../../../assets/demo-runtime/.tests/pass/declared/.env?raw";
import passSource from "../../../assets/demo-runtime/.tests/pass/declared/src/config.ts?raw";

import type { DeliveredFile } from "../deliver";

export { DEMO_RUNTIME_RULE_ID } from "./manifest";

/**
 * Every file the rule directory must contain, in the shape a delivery uses.
 *
 * Deliberately the same `DeliveredFile[]` a served rule produces, so the demo
 * is written by `assessDelivery` + `writeDeliveredFileSet` rather than by a
 * second writer. If this ever needs its own writer, the shapes have diverged
 * and that is the finding.
 */
export const DEMO_RUNTIME_FILES: readonly DeliveredFile[] = [
  { path: "check.ts", content: checkSource },
  { path: "captures/env-read.yml", content: captureEnvironmentRead },
  { path: ".tests/pass/declared/src/config.ts", content: passSource },
  { path: ".tests/pass/declared/.env", content: passEnvironment },
  { path: ".tests/fail/undeclared/src/config.ts", content: failSource },
  { path: ".tests/fail/undeclared/.env", content: failEnvironment },
];
