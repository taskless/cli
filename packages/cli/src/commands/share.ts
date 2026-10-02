import process from "node:process";

import chalk from "chalk";
import { defineCommand } from "citty";
import { encode, renderUnicodeCompact } from "uqr";

import "../util/color";
import { CLI_VERSION } from "../version";
import { BANNER_WIDTH, renderBanner } from "../wizard/intro";

/**
 * The bare minimum to attribute a visit: `source`/`medium` credit the share
 * command, `content` carries the base version with any prerelease or build
 * suffix cut, so every nightly of a release counts toward that release.
 */
const SHARE_URL = `https://www.taskless.io/?${new URLSearchParams({
  utm_source: "cli",
  utm_medium: "share",
  utm_content: CLI_VERSION.split(/[-+]/)[0] ?? CLI_VERSION,
}).toString()}`;

/**
 * The prod invocation, spelled out rather than taken from `buildInvocation()`:
 * a nightly or local build would otherwise share its own pinned launcher,
 * which is not what anyone being shown the code should run.
 */
const SHARE_CAPTION = "`npx @taskless/cli` // www.taskless.io";

/** Left-pad a block of uncolored text to center it under the banner. */
function center(
  block: string,
  style: (line: string) => string = (line) => line
): string {
  return block
    .split("\n")
    .map((line) => {
      const pad = Math.max(0, Math.floor((BANNER_WIDTH - line.length) / 2));
      return " ".repeat(pad) + style(line);
    })
    .join("\n");
}

/**
 * Two modules per line with half blocks, drawn dark-on-white with explicit
 * colors so the code reads the same on a light or a dark terminal theme.
 */
function renderColored(url: string): string {
  const { data } = encode(url, { ecc: "L", border: 2 });
  const lines: string[] = [];
  for (let y = 0; y < data.length; y += 2) {
    const topRow = data[y] ?? [];
    const bottomRow = data[y + 1] ?? [];
    const line = topRow.map((top, x) => {
      const bottom = bottomRow[x] ?? false;
      return top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    });
    lines.push(line.join(""));
  }
  return center(lines.join("\n"), (line) => chalk.bgWhiteBright.black(line));
}

export const shareCommand = defineCommand({
  meta: {
    name: "share",
    description: "Show a QR code for taskless.io",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  run({ args }) {
    if (args.json) {
      console.log(JSON.stringify({ url: SHARE_URL }));
      return;
    }

    // Without color the half blocks fall back to the terminal's own
    // foreground, which assumes a dark theme; better than no code at all.
    const qr =
      chalk.level > 0
        ? renderColored(SHARE_URL)
        : center(renderUnicodeCompact(SHARE_URL, { ecc: "L", border: 2 }));
    const caption = center(SHARE_CAPTION);

    process.stdout.write(`\n${renderBanner()}\n\n${qr}\n\n\n${caption}\n\n`);
  },
});
