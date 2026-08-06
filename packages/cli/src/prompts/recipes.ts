import { sprintf } from "sprintf-js";
import { z } from "zod";

import { applyCliInvocation } from "../util/invocation";
import { inputSchema as ruleCreateInputSchema } from "../schemas/rules-create";
import { inputSchema as ruleImproveInputSchema } from "../schemas/rules-improve";

// Help text files embedded at build time via Vite import.meta.glob.
// Filename convention: <topic>.txt for the canonical recipe and
// <topic>.anonymous.txt for the local-only variant (when the flow
// genuinely differs).
//
// This module is the single embed and the single render path for the
// recipes. Both the `help` command and the `@taskless/cli/prompts`
// export consume it, so the two surfaces cannot drift. It must stay
// free of the CLI runtime — no citty, telemetry, filesystem, or
// network — so a Worker can import the prompts entry without pulling
// the command tree in behind it.
const helpFiles: Record<string, string> = import.meta.glob("../help/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Build two lookup maps:
//   - helpMap: "rule-create"           → canonical recipe text
//   - anonymousMap: "rule-create"      → anonymous variant text (if exists)
function buildHelpMaps(): {
  helpMap: Map<string, string>;
  anonymousMap: Map<string, string>;
} {
  const helpMap = new Map<string, string>();
  const anonymousMap = new Map<string, string>();
  for (const [path, content] of Object.entries(helpFiles)) {
    const filename = path
      .split("/")
      .pop()
      ?.replace(/\.txt$/, "");
    if (!filename) continue;
    if (filename.endsWith(".anonymous")) {
      const topic = filename.slice(0, -".anonymous".length);
      anonymousMap.set(topic, content);
    } else {
      helpMap.set(filename, content);
    }
  }
  return { helpMap, anonymousMap };
}

const { helpMap, anonymousMap } = buildHelpMaps();

/** The canonical `<topic>.txt` recipe names present in the build. */
export function canonicalRecipeTopics(): string[] {
  return [...helpMap.keys()];
}

// Topic → Zod input schema. When a recipe contains the %(INPUT_SCHEMA)s
// placeholder, the renderer substitutes the JSON Schema rendered from
// this Zod source.
const TOPIC_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  "rule-create": ruleCreateInputSchema,
  "rule-improve": ruleImproveInputSchema,
};

/** Agent-fill marker used when the caller does not supply a real value. */
const PACKAGE_MANAGER_DLX_MARKER = "<package-manager-dlx>";

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
function renderRecipe(
  content: string,
  topic: string,
  options: RecipeOptions = {}
): string {
  const variables: Record<string, string> = {
    CLI_VERSION: __VERSION__,
    PACKAGE_MANAGER_DLX:
      options.packageManagerDlx ?? PACKAGE_MANAGER_DLX_MARKER,
  };
  if (content.includes("%(INPUT_SCHEMA)s")) {
    const schema = TOPIC_INPUT_SCHEMAS[topic];
    variables.INPUT_SCHEMA = schema
      ? JSON.stringify(z.toJSONSchema(schema), null, 2)
      : "(no input schema for this topic)";
  }
  const rendered = sprintf(applyCliInvocation(content), variables);
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
 * Look up a help topic from the embedded recipe map and return the rendered
 * text. Anonymous variants are preferred when `anonymous` is set and a
 * variant exists; otherwise the canonical recipe is returned. Returns
 * `undefined` when the topic is unknown.
 */
export function getRecipe(
  topic: string,
  options: RecipeOptions = {}
): string | undefined {
  const content = options.anonymous
    ? (anonymousMap.get(topic) ?? helpMap.get(topic))
    : helpMap.get(topic);
  if (content === undefined) return undefined;
  return renderRecipe(content, topic, options);
}
