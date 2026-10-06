import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself rather than inheriting it from
// whichever caller happened to load `wizard/intro.ts` first.
import "../util/color";

/**
 * The orange box an install draws around a notice it cannot afford to have
 * scrolled past. Shared so every such notice reads as the same kind of thing.
 */

/** Inner text is wrapped to this many columns before the box is sized. */
const WRAP_COLUMNS = 62;

/**
 * Orange, downsampled by chalk to whatever the terminal actually supports.
 *
 * Depth comes from `util/color`, imported above for that side effect. It used
 * to come from `wizard/intro.ts` by accident, because both callers of the
 * original banner import that file for `getCliVersion`. That held, and held
 * for a reason no reader of this file could see: a caller that did not import
 * the wizard would have got a colourless box with no error and nothing to grep
 * for.
 */
const ACCENT = "#ff8c00";

/**
 * One block of a notice: a paragraph wrapped to the box, or a bulleted list
 * whose items wrap under their own text rather than under the bullet.
 */
export type NoticeBlock = string | { items: readonly string[] };

/**
 * Wrap on spaces, never mid-token.
 *
 * A nightly version is a single 30-character token, so a wrapper that split on
 * width would cut one in half and produce a string nobody can copy. An
 * over-long line is allowed to overflow instead, and the box is then sized
 * around it.
 */
function wrap(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= columns) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function renderBlock(block: NoticeBlock): string[] {
  if (typeof block === "string") return wrap(block, WRAP_COLUMNS);
  return block.items.flatMap((item) =>
    wrap(item, WRAP_COLUMNS - 2).map(
      (line, index) => `${index === 0 ? "-" : " "} ${line}`
    )
  );
}

/** Draw `heading` and `blocks`, separated by blank lines, inside the box. */
export function renderNoticeBox(
  heading: string,
  blocks: readonly NoticeBlock[]
): string {
  const body = blocks.flatMap((block, index) => [
    ...(index === 0 ? [] : [""]),
    ...renderBlock(block),
  ]);

  // Sized to the content, so a long nightly version widens the box rather than
  // breaking out of it. Padding is computed on the UNCOLORED text: measuring
  // after chalk has run would count escape sequences as characters and leave
  // every border ragged.
  const inner =
    Math.max(heading.length, ...body.map((line) => line.length)) + 4;

  const edge = chalk.hex(ACCENT);
  const top = edge(`┌${"─".repeat(inner)}┐`);
  const bottom = edge(`└${"─".repeat(inner)}┘`);
  const row = (text: string, render: (value: string) => string) =>
    `${edge("│")}  ${render(text)}${" ".repeat(inner - text.length - 4)}  ${edge("│")}`;

  return [
    "",
    top,
    row(heading, (value) => edge.bold(value)),
    row("", (value) => value),
    ...body.map((line) => row(line, (value) => value)),
    bottom,
    "",
  ].join("\n");
}
