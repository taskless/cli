// The `.js` extension is deliberate and is the only import in the package that
// carries one. This module is the published entry for `@taskless/cli/prompts`,
// so `tsc` copies this specifier verbatim into `dist/prompts/index.d.ts`. An
// extensionless specifier there fails to resolve for a consumer on
// `moduleResolution: node16`/`nodenext`, which is a trap we would be shipping
// rather than hitting ourselves. Both the type-checker and Vite map `.js` back
// to this `.ts` source, so nothing else changes.
import { getRecipe, type RecipeOptions } from "./recipes.js";

/**
 * Public entry for `@taskless/cli/prompts`.
 *
 * Everything here renders through the same embedded recipe text and the same
 * render path `taskless help <topic>` serves, so the two surfaces cannot emit
 * different guidance. Nothing in this graph reaches the CLI runtime: no citty
 * command tree, no telemetry, no filesystem or network, so a Worker can import
 * it without dragging the CLI in behind it.
 */

/**
 * Topics exported as public API. Hand-maintained rather than derived from the
 * recipe files, because an exported name is a promise held for a major version
 * and a new `help/*.txt` must not be able to publish one by existing. The
 * completeness check in `test/prompts.test.ts` asserts this list plus
 * {@link INTERNAL_TOPICS} accounts for every canonical recipe on disk.
 *
 * The list starts at what a consumer has actually asked for and grows on
 * demand. `static` is the canonical on-disk rule shape, the one topic the
 * generator's decision router can use server-side.
 */
export const TOPICS = ["static"] as const;

/**
 * Recipes deliberately withheld from the export, recorded so they stay visible
 * decisions rather than oversights. Two groups:
 *
 * - Command recipes (`auth` … `update`) walk an agent through running a CLI
 *   subcommand on a developer's machine. There is no caller for them outside
 *   the CLI that hosts those commands.
 * - Authoring recipes are unreachable server-side: `route` picks an authoring
 *   destination before the service is involved, `remote` states the boundary
 *   from the client's side, `detect` documents a CLI subprocess a Worker
 *   cannot spawn, `existing` targets a local toolchain, and `rule-meta` reads
 *   a `rule improve` sidecar file.
 */
export const INTERNAL_TOPICS = [
  "auth",
  "check",
  "ci",
  "detect",
  "existing",
  "info",
  "init",
  "onboard",
  "remote",
  "route",
  "rule",
  "rule-create",
  "rule-delete",
  "rule-improve",
  "rule-meta",
  "rule-verify",
  "update",
] as const;

/** A topic name the package exports. Unknown names fail to type-check. */
export type PromptTopic = (typeof TOPICS)[number];

/** Options accepted by every prompt render function. */
export type PromptOptions = RecipeOptions;

/**
 * Render a prompt to finished text. Every `%(KEY)s` placeholder is resolved
 * from values the package already holds, so the caller never handles a
 * template dialect.
 *
 * @throws when the topic has no canonical recipe in the build, which means
 * {@link TOPICS} and the recipe files have diverged.
 */
export function getPrompt(topic: PromptTopic, options?: PromptOptions): string {
  const rendered = getRecipe(topic, options);
  if (rendered === undefined) {
    throw new Error(
      `No recipe is embedded for prompt topic "${topic}". This is a packaging fault: TOPICS lists a topic with no help/${topic}.txt behind it.`
    );
  }
  return rendered;
}

/** Every exported topic as a render function, keyed by topic name. */
export const PROMPTS: Record<PromptTopic, (options?: PromptOptions) => string> =
  Object.fromEntries(
    TOPICS.map((topic) => [
      topic,
      (options?: PromptOptions) => getPrompt(topic, options),
    ])
  ) as Record<PromptTopic, (options?: PromptOptions) => string>;
