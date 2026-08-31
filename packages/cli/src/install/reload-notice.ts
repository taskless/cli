import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself rather than inheriting it from
// whichever caller happened to load `wizard/intro.ts` first.
import "../util/color";

/**
 * The banner an upgrade owes a session that is already running.
 *
 * Installing rewrites files an AI tool has usually ALREADY READ. A coding agent
 * loads its skill and command listing once, when the session starts, so a
 * session open at install time keeps serving the previous copy for the rest of
 * its life. Nothing errors: the agent follows guidance one version out of date
 * and reports success.
 *
 * That is worse here than it would be for most tools, because a Taskless recipe
 * is embedded in the bundle at build time rather than fetched. A stale skill
 * names a stale CLI invocation, which serves a stale recipe, so the answer is
 * wrong rather than missing. An agent following a recipe from an older build
 * once authored four rules against a `language:` spelling the current build had
 * already documented as wrong, and nothing in the run looked unusual.
 *
 * The banner is loud on purpose. The failure it prevents is silent, arrives
 * later, and does not look like an install problem when it does.
 */

/** What this install did to the recorded version. */
export interface ReloadNoticeInput {
  /** The `install.cliVersion` recorded before this run, if there was one. */
  previousCliVersion?: string;
  /** The version this run recorded. */
  cliVersion: string;
}

/** Inner text is wrapped to this many columns before the box is sized. */
const WRAP_COLUMNS = 62;

/**
 * Orange, downsampled by chalk to whatever the terminal actually supports.
 *
 * Depth comes from `util/color`, imported above for that side effect. It used
 * to come from `wizard/intro.ts` by accident, because both callers of this
 * module import that file for `getCliVersion`. That held, and held for a reason
 * no reader of this file could see: a third caller that did not import the
 * wizard would have got a colourless box with no error and nothing to grep for.
 */
const ACCENT = "#ff8c00";

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

/**
 * Whether this run changed the version, which is the only thing that makes an
 * open session stale.
 *
 * A first install is not an upgrade: there was no earlier skill for a running
 * session to be holding. Any move between two recorded versions counts,
 * including a downgrade and including a stable/nightly swap, since both leave
 * the same stale copy in memory.
 */
function versionMoved(input: ReloadNoticeInput): boolean {
  return (
    input.previousCliVersion !== undefined &&
    input.previousCliVersion !== input.cliVersion
  );
}

/**
 * The banner, or `undefined` when this run did not move the version.
 *
 * Printed on the transition rather than on every install. A banner that shows
 * up on runs where nothing changed is one people learn to scroll past, which
 * would cost exactly the runs it exists for.
 */
export function getReloadNotice(input: ReloadNoticeInput): string | undefined {
  if (!versionMoved(input)) return undefined;

  const body = [
    ...wrap(
      `Taskless changed from ${input.previousCliVersion ?? ""} to ${input.cliVersion}.`,
      WRAP_COLUMNS
    ),
    "",
    ...wrap(
      "An AI session that is already open still holds the previous skills, " +
        "because most tools read the skill list once, at startup.",
      WRAP_COLUMNS
    ),
    "",
    ...wrap(
      "Reload skills in your AI tool, or start a new session, before asking " +
        "it to use Taskless.",
      WRAP_COLUMNS
    ),
  ];

  const heading = "RESTART YOUR AGENTS";
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
