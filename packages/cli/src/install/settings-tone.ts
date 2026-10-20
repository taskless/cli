import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. Every module that
// renders a settings edit reaches its colour through here.
import "../util/color";

/**
 * How a settings edit is coloured, wherever it is shown: the wizard's summary,
 * `init`'s printed output, project files and the user's own settings alike.
 *
 * Read as a settings migration. An addition is what the reader needs to
 * notice, so it is green. Removing Taskless's own outdated rules is expected,
 * so it keeps the terminal's colour. A replacement changes an entry the user
 * already has, worth a moment's attention, so it is yellow. A skip is an edit
 * the user has to make by hand, because Taskless will not make it for them,
 * and Taskless commands can be refused until they do: it is the only red.
 *
 * The labels carry the meaning on their own, so output reads the same with
 * colour off.
 */
export const SETTINGS_TONE = {
  allow: (text: string) => chalk.green(text),
  remove: (text: string) => text,
  replace: (text: string) => chalk.yellow(text),
  skip: (text: string) => chalk.red(text),
} as const;

export type SettingsTone = keyof typeof SETTINGS_TONE;
