import { sprintf } from "sprintf-js";
import { z } from "zod";

import {
  applyCliInvocation,
  buildInvocation,
  isProductionInvocation,
} from "../util/invocation";
import { inputSchema as ruleCreateInputSchema } from "../schemas/rules-create";
import { inputSchema as ruleImproveInputSchema } from "../schemas/rules-improve";
import { inputSchema as feedbackInputSchema } from "../schemas/feedback";
import {
  AST_GREP_VERSION,
  VALE_VERSION,
  astGrepLanguageList,
  valeCommentList,
  valeConverterList,
  valeMarkupList,
  valePlaintextList,
} from "../rules/capabilities";

// Agent recipe files embedded at build time via Vite import.meta.glob.
// Filename convention: <topic>.md for the canonical recipe and
// <topic>.anonymous.md for the local-only variant (when the flow
// genuinely differs).
//
// `.md` rather than `.txt`, because that is what they are: headings, tables,
// fenced blocks and emphasis throughout. The extension is not cosmetic. Vale
// has no markdown parser for a `.txt`, so every command example and identifier
// inside a fence was prose to a prose rule, which is why two recipes had to be
// excluded from `no-hedging` wholesale rather than at the paragraph that earned
// it. As `.md` the fences are skipped and `<!-- vale ... -->` regions work, so
// an exclusion can be the size of the example rather than the size of a file.
//
// This module is the single embed and the single render path for the
// recipes. Both the `agent` command and the `@taskless/cli/prompts`
// export consume it, so the two surfaces cannot drift. It must stay
// free of the CLI runtime — no citty, telemetry, filesystem, or
// network — so a Worker can import the prompts entry without pulling
// the command tree in behind it.
const recipeFiles: Record<string, string> = import.meta.glob("../agent/*.md", {
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
  for (const [path, rawContent] of Object.entries(recipeFiles)) {
    const content = stripValeDirectives(rawContent);
    const filename = path.split("/").pop()?.replace(/\.md$/, "");
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

/** The canonical `<topic>.md` recipe names present in the build. */
export function canonicalRecipeTopics(): string[] {
  return [...recipeMap.keys()];
}

// Topic → Zod input schema. When a recipe contains the %(INPUT_SCHEMA)s
// placeholder, the renderer substitutes the JSON Schema rendered from
// this Zod source.
const TOPIC_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  "create-remote-rule": ruleCreateInputSchema,
  "improve-rule": ruleImproveInputSchema,
  feedback: feedbackInputSchema,
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

/**
 * One command-line tool a recipe can condition on, as the host measured it.
 *
 * PRESENCE, NEVER VERIFICATION. `present` means a file of that name was found
 * on the host's `PATH`. Nothing was executed, nothing was hashed and no
 * version was read, so a rendering must say "is on your PATH" and never "is
 * available" — the second is a claim about a working install that nobody
 * checked.
 *
 * Declared HERE rather than beside the detector because this is the render
 * contract, and this module is what `@taskless/cli/prompts` publishes. The
 * detector (`src/detect/host-tools.ts`) imports the type; nothing flows the
 * other way, so the prompts chunk graph stays free of node builtins.
 */
export interface HostTool {
  /** The command as it would be typed, e.g. `gh`. */
  name: string;
  /** A file of this name was found on the host's `PATH`. */
  present: boolean;
  /** Where it was found. Absent exactly when `present` is false. */
  path?: string;
  /**
   * This tool could accomplish something where the recipe will run.
   *
   * A SEPARATE AXIS FROM `present`. `gh` in a repository with no GitHub
   * `origin` is inapplicable however well it is installed, and the sentence a
   * reader needs there ("there are no pull requests to mine") is not the
   * sentence a missing binary earns ("install it"). See
   * {@link RecipeOptions.hostTools} for the precedence this buys.
   */
  applicable: boolean;
  /**
   * WHY {@link applicable} is false, in a fragment that reads inside
   * parentheses — "this repository has no GitHub origin".
   *
   * OPTIONAL, deliberately. This is published surface (`@taskless/cli/prompts`
   * re-exports the type), so requiring it would break every caller already
   * building a `HostTool[]`, and it is meaningless on an applicable tool. The
   * render falls back to a generic line when it is absent, and MUST NOT
   * substitute a reason of its own: a renderer that guesses is how the
   * GitHub-specific sentence came to be printed for tools that have nothing to
   * do with GitHub.
   *
   * It carries an explanation rather than a code because its consumer is an
   * agent reading prose. "Not applicable" tells it to drop a source; the
   * reason tells it whether anything the user could do would change that, which
   * is the difference between staying quiet and suggesting a fix that cannot
   * work.
   *
   * Ignored when `applicable` is true.
   */
  reason?: string;
}

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
   * Render the steps that gather evidence by running this CLI.
   *
   * `false` replaces them with a statement of what the caller must supply
   * instead. It exists because `invocation` cannot do this job: that option
   * substitutes the BINARY NAME inside a command, so a consumer with no CLI
   * setting it to a phrase renders `Run: <no CLI available> detect --json` — a
   * malformed instruction rather than a clean absence, and worse than either
   * honest answer.
   *
   * The evidence itself is not optional. A consumer that cannot run the
   * commands still needs the linters, languages, rule styles, login state and
   * owner, because the routing criteria are stated in terms of them. So this
   * names what to supply rather than dropping the steps.
   *
   * @default true
   */
  mechanics?: boolean;
  /**
   * Include the `# Topic: <name> (CLI v<version> / topic vN)` first line.
   * Suppressing it drops the CLI version from the text, which matters to
   * an LLM consumer whose prompt-cache key would otherwise churn on every
   * CLI publish.
   *
   * @default true
   */
  header?: boolean;
  /**
   * Add the fetch-time directive as the header block's second line: the
   * text was resolved by the CLI when it was fetched, the next task fetches
   * it again, and a session that saw an install or upgrade holds a stale
   * skill until it reloads. The `agent` command asks for it, because what it
   * serves IS a fetch. The prompts export does not, because a consumer
   * embedding a recipe in its own prompt has no CLI to re-run, and the
   * statement would be false there.
   *
   * Lives in the header block so `header: false` drops it with the version.
   *
   * @default false
   */
  directive?: boolean;
  /**
   * What the host has on its `PATH`, for the passages that condition on it.
   *
   * AN ARGUMENT, NEVER AN AMBIENT READ, for the same reason `invocation` is:
   * reading `PATH` needs `process`, and this module is imported by Workers
   * without `nodejs_compat`. The CLI detects (`src/detect/host-tools.ts`) and
   * passes the result in.
   *
   * Omitting it renders every conditioned passage at its default, which is the
   * recipe's full text with no source dropped and no claim made about what is
   * installed. That is the right answer for a consumer of
   * `@taskless/cli/prompts`: it has no `PATH` worth describing, and a recipe
   * trimmed against THIS host's tooling would be describing the wrong machine.
   *
   * When it is supplied, a passage is selected on both fields, and
   * `applicable: false` OUTRANKS `present: false`. A tool that could do
   * nothing here is reported as inapplicable rather than as missing, whether
   * or not it is installed — otherwise a repository with no GitHub remote is
   * told to install `gh`, which is the one instruction that cannot help it.
   */
  hostTools?: HostTool[];
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
/**
 * What a step says when the caller supplies the evidence itself.
 *
 * Deliberately not an empty string: the step's following prose describes what
 * the evidence contains and the criteria below are stated in terms of it, so a
 * consumer that reads "nothing here" and moves on has lost the inputs rather
 * than the commands.
 */
const SUPPLIED_DETECT = "The caller supplies this evidence, which names";
const SUPPLIED_LOGIN = "The caller supplies";

/**
 * The `Run:` block, ending in the connective the step's own prose continues
 * from.
 *
 * The connective is part of the substitution rather than of the template
 * because the prose depends on it grammatically: step 1 continues "…the
 * configured linters", which needs "This returns" before it, and step 2
 * continues "`loggedIn` and `ghOwner`", which needs a verb. Replacing only the
 * command left "This returns" dangling and "and note" as a fragment — a
 * malformed rendering, which is the defect this option exists to remove rather
 * than relocate.
 */
function runBlock(
  invocation: string,
  command: string,
  connective: string
): string {
  return `Run:\n   \`\`\`\n   ${invocation} ${command}\n   \`\`\`\n   ${connective}`;
}

/**
 * Indent every line after the first, so a multi-line block substituted into an
 * indented `%(KEY)s` is still the markdown unit it replaces.
 *
 * The placeholder sits at the position of the block's FIRST line, so that line
 * is already indented by the template and must not be indented again. A blank
 * line stays blank: trailing whitespace on an empty line is a diff nobody
 * wants and `prettier` would strip it back out of the recipe source anyway.
 */
function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : indent + line))
    .join("\n");
}

/**
 * The variable names whose value depends on {@link RecipeOptions.hostTools}.
 *
 * Exported so a caller can ask a TEMPLATE whether detection is worth paying
 * for — `getRawRecipe(topic).variables` reports what sprintf's own parse
 * found — instead of keeping a list of which topics use the mechanism, which
 * would go stale the first time a second recipe adopts one of these.
 */
export const HOST_TOOL_VARIABLES: ReadonlySet<string> = new Set([
  "SOURCE_PR_REVIEW",
  "HOST_TOOLS",
]);

/** The state a passage conditioned on one tool renders from. */
type ToolState = "unknown" | "present" | "absent" | "not-applicable";

/**
 * How a named tool stands, collapsed to the four cases a passage has prose for.
 *
 * `undefined` tools — the whole option omitted, or a list that does not mention
 * this one — are `unknown`, which renders the unconditioned default rather than
 * an absence. Nothing was measured, so nothing may be claimed.
 *
 * PRECEDENCE IS THE POINT: `applicable` is read before `present`, so a tool
 * that is installed but useless here is `not-applicable` and never `absent`.
 */
function toolState(tools: HostTool[] | undefined, name: string): ToolState {
  const tool = tools?.find((candidate) => candidate.name === name);
  if (tool === undefined) return "unknown";
  if (!tool.applicable) return "not-applicable";
  return tool.present ? "present" : "absent";
}

/**
 * The PR-review entry in the onboard recipe's source menu, as a whole list
 * item.
 *
 * A WHOLE ITEM, connective included, for the reason written above
 * {@link runBlock}: the bullet's own marker and label are part of what changes
 * between states, and a substitution that replaced only the sentence would
 * leave a bullet whose label contradicts its body. Every branch below is
 * valid markdown at the same nesting level.
 *
 * The `absent` and `not-applicable` branches SAY WHY rather than dropping the
 * bullet. `route.md` reached the same conclusion for the remote-generation
 * tier it declines to offer: a reader who is not told reads the omission as an
 * oversight and asks for it, which costs a turn and arrives back here.
 */
function prReviewSource(tools: HostTool[] | undefined): string {
  switch (toolState(tools, "gh")) {
    case "present": {
      return `- **Recent PR review comments**: \`gh\` is on your PATH.
Taskless looked for the file and did not run it, so treat that as
presence rather than as a working install. Suggest scanning the last
30 days of merged PRs for repeated reviewer feedback patterns.`;
    }
    case "absent": {
      return `- **Recent PR review comments** are not on this menu: \`gh\` is
not on your PATH. Say that rather than passing over the source in
silence, and offer to pick it up if the user installs the GitHub CLI.`;
    }
    case "not-applicable": {
      return `- **Recent PR review comments** are not on this menu: this
repository has no GitHub origin, so there are no pull requests to
mine. Installing the GitHub CLI does not change that. Say so rather
than passing over the source in silence.`;
    }
    default: {
      return `- **Recent PR review comments**: reading merged PRs needs the
GitHub CLI (\`gh\`) or something equivalent. Suggest scanning the last
30 days of merged PRs for repeated reviewer feedback patterns.`;
    }
  }
}

/**
 * One line of the detected-tool list, phrased as presence.
 *
 * The inapplicable branch prints the TOOL'S OWN reason and never one of its
 * own. It used to hardcode "this repository has no GitHub origin" for every
 * inapplicable tool, which was merely unreachable rather than correct: this is
 * a public render over a caller-supplied array, so a caller marking `jq`
 * inapplicable for an unrelated reason got a confident GitHub explanation.
 * Absent a reason the line stays generic, because a renderer that fills one in
 * is exactly how that happened.
 */
function toolLine(tool: HostTool): string {
  if (!tool.applicable) {
    const because = tool.reason === undefined ? "" : ` (${tool.reason})`;
    return `- \`${tool.name}\`: nothing to do here${because}`;
  }
  return tool.present
    ? `- \`${tool.name}\`: on your PATH${tool.path === undefined ? "" : ` (${tool.path})`}`
    : `- \`${tool.name}\`: not on your PATH`;
}

/**
 * The onboard recipe's tool step, as a whole numbered step including its title.
 *
 * The title is inside the substitution because it is the part that is wrong in
 * the other state: "probe before promising" is the correct instruction when
 * nothing has been measured and a stale one the moment the CLI has answered.
 *
 * THE LIST IS WHAT THE CALLER SUPPLIED, NOT A CENSUS. `hostTools` is public
 * surface and a caller may pass a subset — the mechanism is meant to be reused
 * by recipes with their own tools — so a name can be missing because nobody
 * looked, not because it is not installed. The step says so, because otherwise
 * "the list above is the answer" invites exactly the inference this change
 * exists to prevent: a verdict read out of silence.
 *
 * Without that line the two passages contradict each other on a partial array.
 * {@link prReviewSource} asks {@link toolState} about `gh` specifically and
 * renders the unmeasured default when the array does not mention it, while
 * this step would claim the enumeration was exhaustive.
 */
function hostToolsStep(tools: HostTool[] | undefined): string {
  if (tools === undefined || tools.length === 0) {
    return `**Confirm a tool exists before promising a scan.** For each source
the user picks, check that whatever it needs is actually there. Don't
tell the user "I'll scan PR comments" if the GitHub CLI isn't
installed; say "PR comments need the GitHub CLI, or equivalent; want
me to skip this or wait while you install it?"`;
  }
  return `**Taskless already looked, so don't probe again.** It checked your
PATH for a file of each of these names and executed none of them.
This is presence: not a version, not a working install, not proof the
file is what its name says.

${tools.map((tool) => toolLine(tool)).join("\n")}

Do not run \`command -v\` for the tools listed above; for those the
list is the answer, and re-deriving it costs a turn and can only
agree. A tool NOT listed was not looked for, which is not the same as
not installed — treat it as unknown and probe it yourself if you need
it. MCP servers are absent from the list for that reason: Taskless
cannot see your MCP roster, so whether a bug tracker is reachable
stays your judgement.`;
}

/** The invocation a render should use, resolved the same way `TASKLESS_CLI` is. */
function resolveInvocation(options: RecipeOptions): string {
  return (
    options.invocation ??
    (isProductionInvocation() ? TASKLESS_CLI_MARKER : buildInvocation())
  );
}

export function buildVariables(
  content: string,
  topic: string,
  options: RecipeOptions = {}
): Record<string, string> {
  const variables: Record<string, string> = {
    CLI_VERSION: __VERSION__,
    // Engine reach, from the pinned engine versions rather than transcribed
    // into a recipe. A recipe carrying these lists by hand would go stale on
    // the next binary bump with nothing to catch it, and stale prose about
    // what an engine can read is worse than the silence it replaced — an agent
    // acts on it. `src/rules/capabilities.ts` is the single place a bump edits,
    // and the two vendor-contract tests fail until it agrees with the binary.
    AST_GREP_VERSION,
    AST_GREP_LANGUAGES: astGrepLanguageList(),
    VALE_VERSION,
    VALE_MARKUP_FORMATS: valeMarkupList(),
    VALE_COMMENT_FORMATS: valeCommentList(),
    VALE_PLAINTEXT_FORMATS: valePlaintextList(),
    VALE_CONVERTER_FORMATS: valeConverterList(),
    PACKAGE_MANAGER_DLX:
      options.packageManagerDlx ?? PACKAGE_MANAGER_DLX_MARKER,
    // The two steps that gather evidence by running this CLI. Rendered as
    // whole blocks rather than stripped afterwards, because the default must
    // stay byte-identical to what `taskless agent route` has always printed
    // and a post-strip cannot promise that.
    DETECT_EVIDENCE:
      options.mechanics === false
        ? SUPPLIED_DETECT
        : runBlock(resolveInvocation(options), "detect --json", "This returns"),
    LOGIN_EVIDENCE:
      options.mechanics === false
        ? SUPPLIED_LOGIN
        : runBlock(resolveInvocation(options), "info --json", "and note"),
    // Three steps, in descending order of how much the resolver actually
    // knows: the caller was told how the CLI was launched; the build is a
    // nightly/dev/self that knows what it is; nobody knows, so ask the agent.
    TASKLESS_CLI: resolveInvocation(options),
    // Conditional blocks: one of a fixed set of whole passages, chosen by
    // state the CALLER measured. Substituted whole — bullet marker, step
    // title, connective and all — for the reason `runBlock` documents above,
    // and never post-stripped, which could not promise the default rendering
    // is byte-for-byte the text a consumer with no host receives.
    SOURCE_PR_REVIEW: indentBlock(prReviewSource(options.hostTools), "     "),
    HOST_TOOLS: indentBlock(hostToolsStep(options.hostTools), "   "),
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
  return renderTemplate(applyCliInvocation(content), topic, options);
}

/**
 * Render an already-invocation-rewritten template. Split out from
 * {@link renderRecipe} so a caller that needs the rewritten template for
 * something else — {@link getRenderedRecipe}, which also reports the
 * template's variables — rewrites once and passes it in.
 */
function renderTemplate(
  template: string,
  topic: string,
  options: RecipeOptions = {}
): string {
  const rendered = sprintf(template, buildVariables(template, topic, options));
  if (options.header === false) return stripHeader(rendered);
  return options.directive === true
    ? addDirective(rendered, resolveInvocation(options))
    : rendered;
}

/** Every recipe opens with this marker on its first line. */
const HEADER_PREFIX = "# Topic:";

/**
 * The fetch-time directive, identical for every topic except the invocation.
 * Rendered from the same resolution `%(TASKLESS_CLI)s` uses, so the command
 * an agent is told to re-run is the one that served it.
 */
export function fetchTimeDirective(invocation: string): string {
  return (
    `Resolved by the CLI when you fetched it. Your next Taskless task, in this session or another, ` +
    `fetches it again with \`${invocation} agent <topic>\`; do not reuse this copy. ` +
    `If Taskless was installed or upgraded during this session, the skill in your context is stale until it is reloaded.`
  );
}

/**
 * Insert the directive as line 2 of the header block. Anchored to the first
 * line like {@link stripHeader}, and a no-op on text that does not open with
 * the header, so a malformed recipe is served as-is rather than gaining a
 * directive above its first real line.
 */
function addDirective(content: string, invocation: string): string {
  if (!content.startsWith(HEADER_PREFIX)) return content;
  const firstBreak = content.indexOf("\n");
  if (firstBreak === -1) return `${content}\n${fetchTimeDirective(invocation)}`;
  return `${content.slice(0, firstBreak)}\n${fetchTimeDirective(invocation)}${content.slice(firstBreak)}`;
}

/**
 * Drop the leading header block from rendered recipe text: the `# Topic: …`
 * line, the fetch-time directive beneath it, and the single blank line that
 * separates the block from the body. Everything after that is returned
 * untouched, so the body of a header-less rendering is byte-identical to the
 * default rendering's body.
 *
 * The block is "everything up to the first blank line" rather than a fixed
 * line count, so the directive travels with the version line: a consumer
 * that suppresses the header wants a cache-stable prompt to embed in its own,
 * and an instruction to re-run a CLI is as wrong there as a version string.
 *
 * Deliberately anchored to the first line only. A `# Topic:` string later in
 * a recipe (inside a fenced example, say) is left alone, and a recipe that
 * somehow lacks the header is returned unchanged rather than losing its
 * first real line.
 */
function stripHeader(content: string): string {
  if (!content.startsWith(HEADER_PREFIX)) return content;
  const blockEnd = content.indexOf("\n\n");
  if (blockEnd === -1) return "";
  return content.slice(blockEnd + 2);
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
  // `variables` describes the string we hand back, so it is collected from the
  // post-strip text — not the full template. Every header line carries
  // %(CLI_VERSION)s, so collecting before the strip would report a variable
  // the returned `text` no longer contains.
  const text = options.header === false ? stripHeader(template) : template;
  return {
    text,
    variables: collectVariables(text),
  };
}

/** A topic's rendered text plus the variables its template contains. */
export function getRenderedRecipe(
  topic: string,
  options: RecipeOptions = {}
): RecipeText | undefined {
  const content = lookupRecipe(topic, options);
  if (content === undefined) return undefined;
  const template = applyCliInvocation(content);
  // Variables come from the *template*, never from the rendered text — sprintf
  // has already collapsed `%%` to a literal `%` there — but from the same slice
  // of it that `text` reflects, so a header-less rendering does not report the
  // header's %(CLI_VERSION)s.
  const source = options.header === false ? stripHeader(template) : template;
  return {
    text: renderTemplate(template, topic, options),
    variables: collectVariables(source),
  };
}

/**
 * Remove Vale's in-file directives from a recipe before anyone reads it.
 *
 * A recipe is checked by this repository's own Vale rules, and two of them
 * teach through a worked example that quotes the words a shipped rule flags.
 * `<!-- vale no-hedging.no-hedging = NO -->` marks that example so the rest of
 * the file stays covered, which is only possible because a recipe is markdown.
 *
 * The directives are configuration, not content. Stripping happens HERE, where
 * the embedded files are read into the maps, rather than at any of the three
 * render entry points: one place to be correct, and `getRawRecipe` is covered
 * by the same stroke as the rendered paths.
 *
 * The whole line goes, including its newline. Leaving a blank line behind
 * would change the markdown a reader sees, which would make the exclusion
 * mechanism visible in the output it exists to keep clean.
 */
export function stripValeDirectives(content: string): string {
  return content.replaceAll(/^[ \t]*<!--\s*vale\b.*?-->[ \t]*\r?\n?/gm, "");
}
