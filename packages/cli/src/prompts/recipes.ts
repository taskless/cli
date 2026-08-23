import { sprintf } from "sprintf-js";
import { z } from "zod";

import {
  applyCliInvocation,
  buildInvocation,
  isProductionInvocation,
} from "../util/invocation";
import { inputSchema as ruleCreateInputSchema } from "../schemas/rules-create";
import { inputSchema as ruleImproveInputSchema } from "../schemas/rules-improve";

// Agent recipe files embedded at build time via Vite import.meta.glob.
// Filename convention: <topic>.txt for the canonical recipe and
// <topic>.anonymous.txt for the local-only variant (when the flow
// genuinely differs).
//
// This module is the single embed and the single render path for the
// recipes. Both the `agent` command and the `@taskless/cli/prompts`
// export consume it, so the two surfaces cannot drift. It must stay
// free of the CLI runtime — no citty, telemetry, filesystem, or
// network — so a Worker can import the prompts entry without pulling
// the command tree in behind it.
const recipeFiles: Record<string, string> = import.meta.glob("../agent/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Build two lookup maps:
//   - recipeMap: "rule-create"           → canonical recipe text
//   - anonymousMap: "rule-create"      → anonymous variant text (if exists)
function buildRecipeMaps(): {
  recipeMap: Map<string, string>;
  anonymousMap: Map<string, string>;
} {
  const recipeMap = new Map<string, string>();
  const anonymousMap = new Map<string, string>();
  for (const [path, content] of Object.entries(recipeFiles)) {
    const filename = path
      .split("/")
      .pop()
      ?.replace(/\.txt$/, "");
    if (!filename) continue;
    if (filename.endsWith(".anonymous")) {
      const topic = filename.slice(0, -".anonymous".length);
      anonymousMap.set(topic, content);
    } else {
      recipeMap.set(filename, content);
    }
  }
  return { recipeMap, anonymousMap };
}

const { recipeMap, anonymousMap } = buildRecipeMaps();

/** The canonical `<topic>.txt` recipe names present in the build. */
export function canonicalRecipeTopics(): string[] {
  return [...recipeMap.keys()];
}

// Topic → Zod input schema. When a recipe contains the %(INPUT_SCHEMA)s
// placeholder, the renderer substitutes the JSON Schema rendered from
// this Zod source.
const TOPIC_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  "create-remote-rule": ruleCreateInputSchema,
  "improve-rule": ruleImproveInputSchema,
};

/** Agent-fill marker used when the caller does not supply a real value. */
const PACKAGE_MANAGER_DLX_MARKER = "<package-manager-dlx>";

/**
 * Agent-fill marker for the CLI invocation itself.
 *
 * Deliberately NOT `npx @taskless/cli`. A prod build that was not told how it
 * was launched does not know, and the recipes are read by an agent that can be
 * asked to supply the answer — so asking is strictly better than guessing a
 * launcher the reader may not have.
 */
const TASKLESS_CLI_MARKER = "<taskless-cli>";

/** Options accepted by the shared render path. */
export interface RecipeOptions {
  /**
   * Select the `.anonymous` variant of the topic, falling back to the
   * canonical recipe when the topic has no variant.
   *
   * @default false
   */
  anonymous?: boolean;
  /**
   * Value substituted for the `%(PACKAGE_MANAGER_DLX)s` placeholder. The
   * default is an agent-fill marker, which is the right answer whenever
   * the caller does not know the consuming repo's package manager.
   *
   * @default "<package-manager-dlx>"
   */
  packageManagerDlx?: string;
  /**
   * Value substituted for the `%(TASKLESS_CLI)s` placeholder: the full command
   * a reader would type to run this CLI, launcher and package specifier
   * included (`npx @taskless/cli@latest`, `pnpm dlx @taskless/cli-nightly@…`).
   *
   * THIS IS AN ARGUMENT, NEVER AN AMBIENT READ. Detecting the launcher needs
   * `process.argv` and `process.env`, and this module is imported by Workers
   * without `nodejs_compat`, where a module-scope `process` read throws at
   * import time. `assert-prompts-graph` in `vite.config.ts` would not catch it
   * either — `process` is a global, not an import — so the constraint is kept
   * by shape: the CLI detects and passes the value in (see
   * `src/util/package-manager.ts`), and a host that imports
   * `@taskless/cli/prompts` passes nothing and gets the marker.
   *
   * Omitting it falls back to this build's own invocation when the build is
   * not prod, and to the agent-fill marker otherwise.
   *
   * @default "<taskless-cli>"
   */
  invocation?: string;
  /**
   * Include the `# Topic: <name> (CLI v<version> / topic vN)` first line.
   * Suppressing it drops the CLI version from the text, which matters to
   * an LLM consumer whose prompt-cache key would otherwise churn on every
   * CLI publish.
   *
   * @default true
   */
  header?: boolean;
}

/**
 * Render a recipe by interpolating sprintf-js named arguments. The recipe
 * source uses `%(KEY)s` placeholders; the variable table built here resolves
 * each known placeholder to its rendered string. Recipes that contain a
 * literal `%` character must escape it as `%%` per sprintf-js conventions.
 *
 * Two flavors of substitution coexist in the variables table:
 * - System-resolved values (e.g. `CLI_VERSION`) — rendered to a real value.
 * - Agent-fill markers (e.g. `PACKAGE_MANAGER_DLX`) — rendered as
 *   `<lower-kebab-name>` so the consuming agent knows to substitute.
 */
export function buildVariables(
  content: string,
  topic: string,
  options: RecipeOptions = {}
): Record<string, string> {
  const variables: Record<string, string> = {
    CLI_VERSION: __VERSION__,
    PACKAGE_MANAGER_DLX:
      options.packageManagerDlx ?? PACKAGE_MANAGER_DLX_MARKER,
    // Three steps, in descending order of how much the resolver actually
    // knows: the caller was told how the CLI was launched; the build is a
    // nightly/dev/self that knows what it is; nobody knows, so ask the agent.
    TASKLESS_CLI:
      options.invocation ??
      (isProductionInvocation() ? TASKLESS_CLI_MARKER : buildInvocation()),
  };
  if (content.includes("%(INPUT_SCHEMA)s")) {
    const schema = TOPIC_INPUT_SCHEMAS[topic];
    variables.INPUT_SCHEMA = schema
      ? JSON.stringify(z.toJSONSchema(schema), null, 2)
      : "(no input schema for this topic)";
  }
  return variables;
}

/**
 * The sprintf variable names a template actually contains, in the order
 * sprintf-js asks for them, de-duplicated.
 *
 * ASKS THE PARSER, DOES NOT RE-DERIVE IT. `sprintf-js` exports no parser
 * (`sprintf`/`vsprintf` only), but its named-argument lookup is plain property
 * access on the value object — so rendering against a `Proxy` that records
 * every key it is asked for makes sprintf's own parse report the variable
 * list. A regex over the template would be the weaker tool
 * `.conventions/STYLEGUIDE-CODE.md` forbids here: it would report names inside
 * a fenced example the parser never reaches, and would miss anything the
 * library's grammar accepts that the pattern does not.
 *
 * THE RENDERED OUTPUT OF THIS PASS IS DISCARDED, and must be. sprintf collapses
 * an escaped `%%` to a literal `%` while parsing, irreversibly — text that has
 * been through it is no longer a valid template, so it can never be what
 * {@link getRawRecipe} hands back.
 */
function collectVariables(template: string): string[] {
  const seen = new Set<string>();
  const recorder = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "string") seen.add(key);
        return "";
      },
      has() {
        return true;
      },
    }
  );
  sprintf(template, recorder);
  return [...seen];
}

/** A recipe's text plus the sprintf variables its template contains. */
export interface RecipeText {
  text: string;
  variables: string[];
}

function renderRecipe(
  content: string,
  topic: string,
  options: RecipeOptions = {}
): string {
  const rendered = sprintf(
    applyCliInvocation(content),
    buildVariables(content, topic, options)
  );
  return options.header === false ? stripHeader(rendered) : rendered;
}

/** Every recipe opens with this marker on its first line. */
const HEADER_PREFIX = "# Topic:";

/**
 * Drop the leading header block from rendered recipe text: the `# Topic: …`
 * line itself plus the single blank line that separates it from the body.
 * Everything after that is returned untouched, so the body of a header-less
 * rendering is byte-identical to the default rendering's body.
 *
 * Deliberately anchored to the first line only. A `# Topic:` string later in
 * a recipe (inside a fenced example, say) is left alone, and a recipe that
 * somehow lacks the header is returned unchanged rather than losing its
 * first real line.
 */
function stripHeader(content: string): string {
  const firstBreak = content.indexOf("\n");
  if (firstBreak === -1) {
    return content.startsWith(HEADER_PREFIX) ? "" : content;
  }
  if (!content.startsWith(HEADER_PREFIX)) return content;
  const body = content.slice(firstBreak + 1);
  return body.startsWith("\n") ? body.slice(1) : body;
}

/**
 * Look up an agent recipe topic from the embedded recipe map and return the rendered
 * text. Anonymous variants are preferred when `anonymous` is set and a
 * variant exists; otherwise the canonical recipe is returned. Returns
 * `undefined` when the topic is unknown.
 */
export function getRecipe(
  topic: string,
  options: RecipeOptions = {}
): string | undefined {
  const content = lookupRecipe(topic, options);
  if (content === undefined) return undefined;
  return renderRecipe(content, topic, options);
}

/** The embedded source text for a topic, honoring the anonymous fallback. */
function lookupRecipe(
  topic: string,
  options: RecipeOptions
): string | undefined {
  return options.anonymous
    ? (anonymousMap.get(topic) ?? recipeMap.get(topic))
    : recipeMap.get(topic);
}

/**
 * The **unrendered** template for a topic, plus the variables it contains.
 *
 * `text` is the source recipe with the build-target invocation rewrite applied
 * and nothing else. The rewrite belongs here: it is build-target substitution
 * rather than templating, and omitting it would make the raw text render to
 * something the CLI never emits. Every `%(KEY)s` is left standing so a host
 * that knows a value this package cannot know — its own launcher, its own
 * package manager — can render the text itself.
 *
 * Returns `undefined` for an unknown topic, matching {@link getRecipe}. The
 * public accessors in `./index.ts` turn that into a throw.
 */
export function getRawRecipe(
  topic: string,
  options: RecipeOptions = {}
): RecipeText | undefined {
  const content = lookupRecipe(topic, options);
  if (content === undefined) return undefined;
  const template = applyCliInvocation(content);
  return {
    text: options.header === false ? stripHeader(template) : template,
    variables: collectVariables(template),
  };
}

/** A topic's rendered text plus the variables its template contains. */
export function getRenderedRecipe(
  topic: string,
  options: RecipeOptions = {}
): RecipeText | undefined {
  const content = lookupRecipe(topic, options);
  if (content === undefined) return undefined;
  return {
    text: renderRecipe(content, topic, options),
    variables: collectVariables(applyCliInvocation(content)),
  };
}
