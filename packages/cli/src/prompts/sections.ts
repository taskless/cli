/**
 * Table-of-contents serving for agent recipes (taskless/cli#672).
 *
 * A recipe is markdown whose `## ` headings divide it into sections. Every
 * section is addressable by name, the slug of its heading, and a section an
 * author marks with {@link ON_DEMAND_MARKER} is left out of the topic's
 * default output: the `agent` command prints the rest, followed by a table of
 * contents naming what it left out and the command that prints each one.
 *
 * Agent harnesses show a tool call's output only up to a limit, and cut the
 * middle out of anything longer. The longest recipes were several times that
 * limit, and what fell out of the middle was the reference material a step
 * depended on. Serving the steps whole and the reference on request keeps
 * every fetch under the limit without dropping anything.
 *
 * Pure string work, like the rest of `src/prompts/`: this module is part of
 * the graph `@taskless/cli/prompts` publishes, so it may not read the
 * filesystem, the environment or `process`.
 */

/**
 * The line an author writes directly above a `## ` heading to serve that
 * section on request rather than in the topic's default output.
 *
 * An HTML comment because a reader of the rendered markdown should not see
 * it, and it is removed from every rendering when the recipe is loaded, the
 * same way Vale's directives are. What it leaves behind is the set of names
 * {@link parseRecipeSource} returns.
 */
export const ON_DEMAND_MARKER = "<!-- on-demand -->";

/** The opening of a section heading. Deeper headings stay inside a section. */
const SECTION_HEADING = "## ";

/** A fence opener or closer, indented or not, as the recipes write them. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * The name a heading is addressed by: lowercase, with every run of characters
 * other than letters and digits collapsed to one hyphen. `Migrating to 0.12.0`
 * is `migrating-to-0-12-0`, and a cross-reference written as a markdown link
 * to `#migrating-to-0-12-0` names the same section.
 */
export function sectionSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replaceAll(/[^a-z\d]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/** A recipe source with its on-demand markers removed and recorded. */
export interface RecipeSource {
  /** The source text, without any {@link ON_DEMAND_MARKER} line. */
  content: string;
  /** The names of the sections the author marked on demand. */
  onDemand: ReadonlySet<string>;
}

/**
 * Lift the on-demand markers out of a recipe source.
 *
 * A marker that does not sit directly above a `## ` heading throws. Recipes
 * are embedded at build time, so the throw happens the first time anything
 * loads them, which is every test that renders one: a misplaced marker cannot
 * ship as a section that silently prints in full.
 */
export function parseRecipeSource(source: string, file: string): RecipeSource {
  const lines = source.split("\n");
  const kept: string[] = [];
  const onDemand = new Set<string>();
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || line.trim() !== ON_DEMAND_MARKER) {
      kept.push(line);
      continue;
    }
    const next = lines[index + 1] ?? "";
    if (!next.startsWith(SECTION_HEADING)) {
      throw new Error(
        `${file}:${String(index + 1)}: ${ON_DEMAND_MARKER} must sit directly above a "${SECTION_HEADING}" heading`
      );
    }
    onDemand.add(sectionSlug(next.slice(SECTION_HEADING.length)));
  }
  return { content: kept.join("\n"), onDemand };
}

/** One `## ` section of a rendered recipe. */
export interface RecipeSection {
  /** The slug its heading is addressed by. */
  name: string;
  /** The heading's text, without the `## `. */
  title: string;
  /** The heading line and everything up to the next `## ` heading. */
  text: string;
}

/** A rendered recipe divided at its `## ` headings. */
export interface SplitRecipe {
  /** Everything before the first `## `: the header and the per-call rule. */
  preamble: string;
  sections: RecipeSection[];
}

/**
 * Divide rendered recipe text at its `## ` headings. A heading inside a
 * fenced block is an example, not a boundary.
 *
 * Two headings with the same slug throw: a section is addressed by its name
 * alone, so the second would be unreachable by `--section`, and an on-demand
 * marker on either would hide both.
 */
export function splitSections(text: string): SplitRecipe {
  const preamble: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith(SECTION_HEADING)) {
      sections.push({
        title: line.slice(SECTION_HEADING.length).trim(),
        lines: [line],
      });
      continue;
    }
    const current = sections.at(-1);
    if (current === undefined) preamble.push(line);
    else current.lines.push(line);
  }
  const seen = new Set<string>();
  const named = sections.map(({ title, lines }) => {
    const name = sectionSlug(title);
    if (seen.has(name)) {
      throw new Error(
        `Two "${SECTION_HEADING}" headings share the section name "${name}"`
      );
    }
    seen.add(name);
    return { name, title, text: lines.join("\n") };
  });
  return { preamble: preamble.join("\n"), sections: named };
}

/** A markdown link to a section of the same recipe: `[Quirks](#quirks)`. */
const SECTION_LINK = /\[([^\]\n]+)\]\(#([a-z\d-]+)\)/g;

/**
 * The names a text links to with `[…](#name)`, for the cross-reference check.
 */
export function sectionLinks(text: string): string[] {
  return [...text.matchAll(SECTION_LINK)].map((match) => match[2] ?? "");
}

/**
 * Turn each link to a section the reader was not given into its name, which
 * the table of contents (or a section's closing line) says how to print. A
 * link to a section in the same output is left alone, and so is the whole
 * text in a full rendering, where every anchor resolves.
 *
 * The name rather than the whole command, because a command spells the
 * invocation, and a nightly's runs past fifty characters: written out at every
 * link it cost a long recipe more than the sections it moved out.
 */
function rewriteLinks(text: string, printed: ReadonlySet<string>): string {
  return text.replaceAll(SECTION_LINK, (link, label: string, name: string) => {
    if (printed.has(name)) return link;
    // `[Quirks](#quirks)` reads as "section `quirks`"; a label that says
    // something the name does not keeps it in front.
    return sectionSlug(label) === name
      ? `section \`${name}\``
      : `${label} (section \`${name}\`)`;
  });
}

/** How the served text names the command that prints one section. */
export type SectionFetch = (name: string) => string;

/**
 * The topic's default output: every section the author did not mark on
 * demand, in order, then a table of contents for the ones it left out. A
 * recipe with no on-demand section is returned unchanged.
 */
export function renderOutline(
  split: SplitRecipe,
  onDemand: ReadonlySet<string>,
  fetch: SectionFetch
): string {
  const omitted = split.sections.filter(({ name }) => onDemand.has(name));
  const shown = split.sections.filter(({ name }) => !onDemand.has(name));
  const body = [split.preamble, ...shown.map(({ text }) => text)].join("\n");
  if (omitted.length === 0) return body;
  const printed = new Set(shown.map(({ name }) => name));
  // Each entry is the name alone: a long recipe has a dozen of these, and the
  // outline's budget is better spent on its steps. The name is the heading's
  // slug, so the heading adds nothing unless it carries code a slug drops.
  const contents = [
    "## Sections on request",
    "",
    `Not printed above. When the text names one, print it with \`${fetch("<name>")}\`:`,
    "",
    ...omitted.map(({ name, title }) =>
      title.includes("`") ? `- \`${name}\`: ${title}` : `- \`${name}\``
    ),
  ].join("\n");
  return `${rewriteLinks(body, printed).trimEnd()}\n\n${contents}\n`;
}

/**
 * One section on its own, under the recipe's preamble so the header and the
 * one-command-per-call rule travel with it, then a line naming the topic it
 * belongs to.
 */
export function renderSection(
  split: SplitRecipe,
  section: RecipeSection,
  fetch: SectionFetch,
  topicFetch: string
): string {
  const body = rewriteLinks(
    `${split.preamble}\n${section.text}`.trimEnd(),
    new Set([section.name])
  );
  return `${body}\n\nThis is one section of a longer recipe. Its steps are printed by \`${topicFetch}\`, and another section by \`${fetch("<name>")}\`.\n`;
}
