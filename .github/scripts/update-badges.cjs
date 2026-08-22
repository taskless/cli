#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Write the shields endpoint payloads for the toolchain badges.
 *
 * `.shields/vale.json` and `.shields/sg.json` are served straight off
 * raw.githubusercontent.com and rendered by
 * `img.shields.io/endpoint?url=…`. Shields cannot ask "is there a newer
 * upstream we have not pinned", so the color rule lives here, in code that is
 * reviewed like everything else.
 *
 * THE MESSAGE CARRIES A DATE, AND THAT IS THE STALENESS SIGNAL.
 *
 * A badge that has stopped being updated looks exactly like a badge whose
 * value has not changed — both render `vale | 3.17.1` forever. That is the
 * failure this repository keeps hitting: an absent signal reading as a passing
 * one. The fix has to be visible where the badge is read, because a
 * `checkedAt` field buried in a JSON file nobody opens is a record, not a
 * signal. So the message is `<version> · <YYYY-MM-DD>`, and a reader who sees
 * a date from four months ago knows the job died rather than that upstream has
 * been quiet.
 *
 * The date is deliberately NOT refreshed on every run, or the badge would be
 * rewritten daily and every rewrite is a commit to `main` (see the loop note in
 * update-badges.yml). It advances only once it is STALE_AFTER_DAYS old, so a
 * daily schedule produces at most one commit a week per badge while still
 * detecting an upstream release within a day of it happening. The date means
 * "checked no earlier than this", which is the guarantee a reader needs, and
 * the window of imprecision is bounded by the constant below.
 *
 * The payload is exactly the shields endpoint schema and carries no extra
 * fields: the record and the signal are the same string, so they cannot drift
 * apart, and there is no chance of shields rejecting an unrecognized key.
 *
 * Usage:
 *   node .github/scripts/update-badges.cjs [--write]
 *
 *   --write  rewrite the payloads whose rendered badge changed. Without it the
 *            script reports what it would do and touches nothing.
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   changed   "true" when at least one payload was (or would be) rewritten
 */

const {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");

const { main: valeDetect } = require("./vale-detect.cjs");
const { main: sgDetect } = require("./sg-detect.cjs");

const SHIELDS_DIRECTORY = join(__dirname, "..", "..", ".shields");

/** How old the recorded date may get before a run refreshes it. */
const STALE_AFTER_DAYS = 7;

const MESSAGE_SEPARATOR = " · ";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/** `2026-08-21`, in UTC, so the date does not depend on where a runner is. */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` strings, both read as UTC midnight. */
function daysBetween(earlier, later) {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86_400_000
  );
}

/**
 * Split `3.17.1 · 2026-08-21` back into its parts. Anything that does not have
 * that shape — a hand-edited file, a payload written before this format, a
 * truncated write — yields no date, which makes the next run rewrite it. That
 * is the right bias: an unreadable badge should be replaced, not preserved.
 */
function parseMessage(message) {
  const [version, date] = String(message ?? "").split(MESSAGE_SEPARATOR);
  return {
    version,
    date: DATE_PATTERN.test(date ?? "") ? date : undefined,
  };
}

/**
 * The badge a comparison should render, given what is already committed.
 *
 * Pure, and the only place the color rule and the date rule live. Keeping the
 * committed date when nothing else moved is what stops a daily schedule from
 * committing daily; keeping it only while it is fresh is what stops the badge
 * from claiming a check that never happened.
 */
function planBadge({ label, comparison, today, previous }) {
  const color = comparison.ahead ? "yellow" : "green";
  const before = parseMessage(previous?.message);

  const keepDate =
    before.date !== undefined &&
    before.version === comparison.pinned &&
    previous?.color === color &&
    daysBetween(before.date, today) < STALE_AFTER_DAYS;

  return {
    schemaVersion: 1,
    label,
    message: `${comparison.pinned}${MESSAGE_SEPARATOR}${keepDate ? before.date : today}`,
    color,
  };
}

/** The committed payload, or undefined when there is not a readable one. */
function readBadge(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function serialize(badge) {
  return `${JSON.stringify(badge, null, 2)}\n`;
}

async function main({
  argv = process.argv.slice(2),
  directory = SHIELDS_DIRECTORY,
  now = new Date(),
  detect = {
    // --json keeps each detect script's human narration off stdout; the answer
    // comes back as the return value rather than out of the printed line, so
    // nothing here parses anything.
    vale: () => valeDetect({ argv: ["--json"] }),
    sg: () => sgDetect({ argv: ["--json"] }),
  },
} = {}) {
  const write = argv.includes("--write");
  const today = formatDate(now);

  const badges = [
    { label: "vale", file: "vale.json", comparison: await detect.vale() },
    { label: "sg", file: "sg.json", comparison: await detect.sg() },
  ];

  let changed = false;
  for (const { label, file, comparison } of badges) {
    const path = join(directory, file);
    const previous = readBadge(path);
    const badge = planBadge({ label, comparison, today, previous });
    const next = serialize(badge);

    if (previous !== undefined && serialize(previous) === next) {
      console.log(`${file}: unchanged (${badge.message}, ${badge.color})`);
      continue;
    }

    changed = true;
    console.log(`${file}: ${badge.message}, ${badge.color}`);
    if (write) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, next);
    }
  }

  if (!write) {
    console.log("\nPass --write to update the payloads.");
  }
  setOutput("changed", String(changed));
  return { changed };
}

module.exports = { main, planBadge };

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nupdate-badges failed: ${error.message}`);
    process.exitCode = 1;
  });
}
