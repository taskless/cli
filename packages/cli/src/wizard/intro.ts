import chalk from "chalk";

// Sets `chalk.level` from the real terminal on import. Kept as an explicit
// import because this module renders colour and must not rely on another
// module having loaded it first.
import "../util/color";

declare const __VERSION__: string;
const CLI_VERSION: string =
  typeof __VERSION__ === "string" ? __VERSION__ : "unknown";

/**
 * The Taskless wordmark rendered as 60×5 quad-block ASCII. Produced offline
 * from tmp/logo-dark-on-white.png via tmp/ascii-tool/convert.mjs; see
 * design.md "Intro banner" for rationale. The string is colorless — callers
 * apply color at render time so NO_COLOR works naturally.
 */
const BANNER = `
██████████
▄▄▄▄   ▗▄▄  ▗▄█▙▄▖ ▗▄▄▖   ▄▄▄ ▐█  ▄▖ ▀▀█    ▄▄▖   ▄▄▄   ▄▄▄
██▛▘▗▟████  ▝▀█▛▀▘ ▀ ▝█▖ █▙ ▝▘▐█▗▟▀    █  ▗█▘ ▜▙ █▙ ▝▘ █▙ ▝▘
█▛ ▗██████    █▌  ▐█▀▀█▌  ▀▀▜▙▐█▀▜▙    █  ▐█▀▀▀▀  ▀▀▜▙  ▀▀▜▙
█▘ ███████    ▀▀▀▘▝▀▀▀▀▀ ▀▀▀▀▘▝▀  ▀▘ ▀▀▀▀▀ ▝▀▀▀▘ ▀▀▀▀▘ ▀▀▀▀▘
`.trim();

/**
 * Return the wizard banner styled for the terminal. Honors NO_COLOR and
 * non-TTY contexts via chalk's built-in detection.
 */
export function renderIntro(): string {
  const version = chalk.dim(`v${CLI_VERSION}`);
  return `${renderBanner()}\n${version}`;
}

/** The wordmark alone, colored, for callers that lay out their own content. */
export function renderBanner(): string {
  // Direct hex instead of chalk.dim(chalk.cyan(…)): the composed form
  // emits reset codes at each newline and the reapplication flashes
  // brighter on some quadrant chars. A single truecolor attribute
  // stays flat across the whole banner.
  return chalk.hex("#2B7384")(BANNER);
}

/** Columns the widest banner line occupies; every glyph in it is one column. */
export const BANNER_WIDTH = Math.max(
  ...BANNER.split("\n").map((line) => line.length)
);

export function getCliVersion(): string {
  return CLI_VERSION;
}
