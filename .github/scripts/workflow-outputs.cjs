// SPDX-License-Identifier: MIT
"use strict";

/**
 * Guard the shell quoting of workflow step outputs.
 *
 * `echo 'key=value' >> "$GITHUB_OUTPUT"` is single-quoted for a reason: the
 * values it writes here contain backticks and `$`, which double quotes would
 * hand to the shell. Single quotes have exactly one failure mode, and it is
 * silent — an apostrophe inside the value CLOSES the string early, and the rest
 * of the line becomes shell words. In the review workflow's `focus=` strings
 * that would mean a future contraction ("don't", "doesn't", "won't") breaking
 * the step for every mode at once, with nothing in review to catch it: the
 * strings are hundreds of characters of prose on one line, and a reviewer
 * reading prose is not reading quoting.
 *
 * This is a textual property of hand-written YAML — the invariant IS "what the
 * shell sees on this line" — so it is checked by reading the lines, not by
 * parsing the YAML into a structure that has already discarded the quoting.
 * Node builtins only, like every other script here.
 *
 * Two rules, both applied to every file in `.github/workflows/`:
 *
 *   1. A single-quoted `echo` that writes to `$GITHUB_OUTPUT` must be exactly
 *      `echo 'key=value' >> "$GITHUB_OUTPUT"`, with no apostrophe inside the
 *      value and nothing after the closing quote but the redirect. This catches
 *      the apostrophe, an unterminated string, and a value wrapped onto a
 *      second line ($GITHUB_OUTPUT is line-oriented; a multi-line value needs
 *      heredoc syntax and is a different thing entirely).
 *
 *   2. Where a file both WRITES a key's values and COMPARES that key against a
 *      literal — `steps.prep.outputs.mode != 'full'` — the literal must be one
 *      of the values written. That is the drift the mode/focus split invites:
 *      two independently-maintained places encoding the same fact, where
 *      renaming one leaves a gate that silently never matches. Keys the file
 *      does not write with a single-quoted echo (an action's own outputs, say)
 *      are skipped — there is no ground truth for those here.
 */

const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

/**
 * `echo 'key=value' >> "$GITHUB_OUTPUT"`, whole and correctly quoted.
 *
 * `[^']*` is what does the work: an apostrophe in the value ends the capture
 * early, and the literal `' >> "$GITHUB_OUTPUT"` that must follow then fails to
 * match, so the line is reported rather than silently accepted.
 */
const OUTPUT_LINE =
  /^echo '([A-Za-z_][A-Za-z0-9_]*)=([^']*)' >> "\$GITHUB_OUTPUT"$/;

/**
 * A single-quoted echo, correct or not.
 *
 * Deliberately NOT "…and mentions $GITHUB_OUTPUT": a value wrapped onto a
 * second line leaves the redirect on the line below, so keying off the redirect
 * would skip exactly the malformed line it needs to see.
 */
const OUTPUT_LINE_CANDIDATE = /^echo '/;

/** `steps.<id>.outputs.<key> == 'literal'` (or `!=`), in an `if:` or anywhere. */
const OUTPUT_COMPARISON =
  /steps\.[A-Za-z0-9_-]+\.outputs\.([A-Za-z0-9_]+)\s*[!=]=\s*'([^']*)'/g;

/**
 * Check one workflow file's source. Returns a list of human-readable problems;
 * an empty list means the file is fine.
 */
function checkWorkflowSource(source, name) {
  const errors = [];
  /** @type {Map<string, Set<string>>} key → every value written for it */
  const written = new Map();

  const lines = source.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!OUTPUT_LINE_CANDIDATE.test(line)) continue;

    const where = `${name}:${String(index + 1)}`;
    const expected = `Expected echo 'key=value' >> "$GITHUB_OUTPUT" on one line, with no apostrophe in the value.`;

    // An odd number of quotes means the string never closed on this line —
    // either an apostrophe inside the value (which closed it early, leaving the
    // rest as shell words) or a value wrapped onto the next line.
    const quotes = (line.match(/'/g) ?? []).length;
    if (quotes % 2 === 1) {
      errors.push(
        `${where}: unterminated single-quoted string — an apostrophe in the ` +
          `value, or a value continued on the next line. ${expected} Got: ${line}`
      );
      continue;
    }

    // A balanced line that is not writing an output is none of our business:
    // `echo 'threads: 3'` into the log is fine.
    if (!line.includes("$GITHUB_OUTPUT")) continue;

    const match = OUTPUT_LINE.exec(line);
    if (match === null) {
      errors.push(`${where}: malformed step output. ${expected} Got: ${line}`);
      continue;
    }

    const [, key, value] = match;
    const values = written.get(key) ?? new Set();
    values.add(value);
    written.set(key, values);
  }

  for (const match of source.matchAll(OUTPUT_COMPARISON)) {
    const [, key, literal] = match;
    const values = written.get(key);
    // No ground truth for a key this file never writes — an action's own
    // output, or one written by a script rather than an inline echo.
    if (values === undefined) continue;
    if (values.has(literal)) continue;
    errors.push(
      `${name}: compares steps output '${key}' against '${literal}', which ` +
        `this file never writes. Written: ${[...values].sort().join(", ")}.`
    );
  }

  return errors;
}

/** Check every workflow in `directory`. */
function checkWorkflows(directory) {
  const errors = [];
  const files = readdirSync(directory)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const source = readFileSync(join(directory, file), "utf8");
    errors.push(...checkWorkflowSource(source, `.github/workflows/${file}`));
  }

  return { errors, checked: files.length };
}

function main(directory = ".github/workflows") {
  const { errors, checked } = checkWorkflows(directory);

  for (const error of errors) {
    console.error(`::error::${error}`);
  }

  if (errors.length > 0) {
    console.error("");
    console.error(
      `${String(errors.length)} step-output problem(s) in ${String(checked)} workflow file(s).`
    );
    return 1;
  }

  console.log(
    `Step outputs are correctly quoted in ${String(checked)} workflow file(s).`
  );
  return 0;
}

module.exports = { checkWorkflowSource, checkWorkflows, main };

if (require.main === module) {
  process.exit(main(process.argv[2]));
}
