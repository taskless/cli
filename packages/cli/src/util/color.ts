import process from "node:process";

import chalk from "chalk";

/**
 * Set `chalk.level` from the terminal we are ACTUALLY running in.
 *
 * Chalk v5 auto-detects at import time. When the CLI is bundled by Vite there
 * is no TTY at build time, so the detection is baked in as `level: 0` and every
 * colour is silently stripped from the shipped binary. Re-detecting at runtime
 * is what makes colour work at all here.
 *
 * IMPORTING THIS MODULE IS WHAT APPLIES IT. The level is a single global on a
 * shared chalk instance, so any module that renders colour needs it to have run
 * first. Leaving that to "some caller will have imported the right file"
 * produces a colourless box with no error, which is the failure mode this
 * module exists to remove: previously the only copy of this logic lived in
 * `wizard/intro.ts` and everything else inherited it by accident.
 */
export function detectColorLevel(): 0 | 1 | 2 | 3 {
  if (process.env.NO_COLOR) return 0;
  const force = process.env.FORCE_COLOR;
  if (force === "0") return 0;
  if (force === "1") return 1;
  if (force === "2") return 2;
  if (force === "3") return 3;
  // Stdout alone decides, so a redirected stdout (`taskless init > out.txt`)
  // comes out plain even when stderr is still the terminal. Chalk has one level
  // for both streams, so coloured text sent to stderr follows stdout: the
  // `init --json` summary loses its colour when stdout is redirected, and the
  // wizard banner, which only prints when stdout is a terminal, keeps it.
  if (process.stdout.isTTY !== true) return 0;
  const term = process.env.TERM ?? "";
  const colorterm = process.env.COLORTERM ?? "";
  if (colorterm === "truecolor" || colorterm === "24bit") return 3;
  if (/-256(color)?$/i.test(term)) return 2;
  if (term === "" || term === "dumb") return 0;
  return 1;
}

// Applied on import, so a module that renders colour gets it by importing this
// rather than by depending on an unrelated module having been loaded first.
chalk.level = detectColorLevel();
