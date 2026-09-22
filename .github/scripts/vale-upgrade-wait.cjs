#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Vale — wait out the publish race before the upgrade detects anything.
 *
 * THE PUBLISH RACE. vale-upgrade.yml fires on the same push to main that fires
 * release-vale.yml: the merge of a manifest change. Starting together is also
 * the problem. release-vale.yml has to fetch, verify, pack, and publish six
 * packages before the registry can answer "what is published" with the new
 * set, and vale-upgrade-detect.cjs asks the registry. Measured on 3.22.0: the
 * manifest merged at 18:09:13Z, the publish run started three seconds later,
 * the packages were stamped 18:09:30 — and an upgrade run started at 18:09
 * would have compared the pins against the OLD latest, found nothing to do,
 * and exited clean. Before the push trigger existed, the daily cron noticed
 * that publish thirteen hours after the packages were on npm.
 *
 * This script is the two waits that close that gap, in order:
 *
 *   1. waitForReleaseRun — hold until the `Release Vale` run for THIS commit
 *      has concluded. `gh run list --commit` is exact, so a publish run for a
 *      different manifest commit (an earlier release still draining) is never
 *      mistaken for this one. Polls every 30 s for up to 25 minutes; on 3.22.0
 *      the run had stamped the packages 14 s after it started, so the bound is
 *      for a queued runner, not for the work.
 *
 *   2. waitForRegistry — `npm publish` returning is not the same as the
 *      registry's packument serving the new dist-tag; that propagates, usually
 *      in seconds, occasionally longer. Ask the registry the exact question
 *      the detect step is about to ask, with the same script and no side
 *      effects (`--json` alone, which the script refuses to combine with
 *      `--write`), up to five times a minute apart.
 *
 * EVERY EXIT IS 0. A publish that concludes anything but success, one that
 * never appears inside the bound, a registry that still says "current" at the
 * end: each is a `::warning::` and a clean exit, never a failed check. This
 * workflow must not go red over a race it did not cause, and a red here would
 * say "the upgrade is broken" when the truth is "the publish is". The daily
 * schedule in vale-upgrade.yml retries once the packages are actually there,
 * which is what a backstop is for.
 *
 * What the workflow learns is the `ready` output: whether the detect step
 * should run at all. It is "true" when the registry serves a newer set, and
 * "false" when waiting established there is nothing to upgrade to yet.
 *
 * TWO CASES ARE "true" WITHOUT A NEWER SET, on purpose:
 *
 *   - A run that is not a `push` has no publish to wait for: its commit is
 *     whatever main is, and the run list for that commit is empty by
 *     construction, so waiting would only burn the bound. Both waits are
 *     skipped and detect runs against whatever the registry serves.
 *
 *   - A probe that ERRORS on every attempt is kept apart from one that
 *     answers "current". The detect script prints its error to stderr and
 *     nothing to stdout, so reading its stdout alone would take a registry
 *     outage for "still the old version" and the closing warning would blame
 *     propagation for something else. An error that persists is not this
 *     script's to report: the detect step runs the same code next and fails
 *     loudly on it, which is right — a broken registry read is a real
 *     failure, not the race.
 *
 * Usage:
 *   node .github/scripts/vale-upgrade-wait.cjs
 *     [--workflow <file>] [--timeout-minutes <n>] [--poll-seconds <n>]
 *     [--attempts <n>] [--interval-seconds <n>]
 *
 * Reads GITHUB_EVENT_NAME and GITHUB_SHA. `gh` needs GH_TOKEN with
 * `actions: read`.
 *
 * Outputs (appended to $GITHUB_OUTPUT when set):
 *   ready    "true" when the detect step should run
 *   outcome  one word saying why: ahead | skipped | publish-failed |
 *            publish-unfinished | registry-stale | probe-errored
 */

const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");

const RELEASE_WORKFLOW = "release-vale.yml";
const DETECT_SCRIPT = join(__dirname, "vale-upgrade-detect.cjs");

const MINUTE = 60 * 1000;
const SECOND = 1000;

const DEFAULTS = {
  timeoutMs: 25 * MINUTE,
  pollMs: 30 * SECOND,
  attempts: 5,
  intervalMs: 60 * SECOND,
};

function setOutput(key, value, env = process.env) {
  const file = env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

function parseArgs(argv) {
  const read = (name, fallback, scale = 1) => {
    const at = argv.indexOf(name);
    if (at === -1) {
      return typeof fallback === "number" ? fallback * scale : fallback;
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} needs a value`);
    }
    if (typeof fallback === "number") {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${name} needs a positive number, got ${value}`);
      }
      return number * scale;
    }
    return value;
  };
  return {
    workflow: read("--workflow", RELEASE_WORKFLOW),
    timeoutMs: read("--timeout-minutes", DEFAULTS.timeoutMs / MINUTE, MINUTE),
    pollMs: read("--poll-seconds", DEFAULTS.pollMs / SECOND, SECOND),
    attempts: read("--attempts", DEFAULTS.attempts),
    intervalMs: read(
      "--interval-seconds",
      DEFAULTS.intervalMs / SECOND,
      SECOND
    ),
  };
}

/**
 * `gh` as an argv array, never through a shell. A non-zero exit becomes a
 * thrown Error carrying stderr, which the poll loop treats as "not yet
 * registered": one rate-limited or 5xx'd call in fifty polls must not end the
 * wait, let alone the run.
 */
function runGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`gh ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * The detect script in a child process rather than in-process, for two
 * reasons: its stderr passes straight through, so "see the error above" in the
 * log is literally true; and its own $GITHUB_OUTPUT writes stay out of THIS
 * step's outputs, which would otherwise pick up a stray `update=false`.
 */
function probeRegistry() {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  const stdout = execFileSync(process.execPath, [DETECT_SCRIPT, "--json"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(stdout.trim());
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `gh run list --json status,conclusion` as a list of {status, conclusion}. */
function parseRuns(stdout) {
  const runs = JSON.parse(stdout.trim() || "[]");
  if (!Array.isArray(runs)) {
    throw new TypeError(`gh run list returned ${typeof runs}, not an array`);
  }
  return runs.map(({ status, conclusion }) => ({
    status: status ?? "",
    conclusion: conclusion ?? "",
  }));
}

const describeRuns = (runs) =>
  runs.map((run) => `${run.status}/${run.conclusion || "-"}`).join("; ");

/**
 * Hold until every `Release Vale` run for `sha` has concluded.
 *
 * Resolves to `{ outcome: "succeeded" | "failed" | "timeout", runs }`, never
 * rejects on a `gh` failure: a failed call is logged and polled again exactly
 * like "not yet registered", and a call that fails until the deadline is a
 * timeout. The run list can lag the push by a few seconds, so an empty answer
 * is also "not yet".
 */
async function waitForReleaseRun({
  sha,
  workflow = RELEASE_WORKFLOW,
  timeoutMs = DEFAULTS.timeoutMs,
  intervalMs = DEFAULTS.pollMs,
  runGh: gh = runGh,
  sleep = sleepFor,
  log = (line) => console.log(line),
  now = Date.now,
}) {
  if (!sha) {
    throw new Error("waitForReleaseRun needs the commit sha to look for");
  }
  const deadline = now() + timeoutMs;
  let runs = [];
  let lastError;

  for (;;) {
    let state;
    try {
      runs = parseRuns(
        gh([
          "run",
          "list",
          "--workflow",
          workflow,
          "--event",
          "push",
          "--commit",
          sha,
          "--json",
          "status,conclusion",
        ])
      );
      lastError = undefined;
      state = runs.length === 0 ? "not yet registered" : describeRuns(runs);
    } catch (error) {
      runs = [];
      lastError = error;
      state = `${error.message}; treating as not yet registered`;
    }

    if (
      !lastError &&
      runs.length > 0 &&
      runs.every((run) => run.status === "completed")
    ) {
      const outcome = runs.every((run) => run.conclusion === "success")
        ? "succeeded"
        : "failed";
      return { outcome, runs };
    }

    if (now() >= deadline) {
      return {
        outcome: "timeout",
        runs,
        detail: lastError
          ? `the last gh call failed: ${lastError.message}`
          : runs.length === 0
            ? "no run found"
            : describeRuns(runs),
      };
    }

    log(
      `Release Vale for ${sha}: ${state}; retrying in ${intervalMs / SECOND} s.`
    );
    await sleep(intervalMs);
  }
}

/**
 * Hold until the registry serves a newer set than the pins.
 *
 * Resolves to `{ outcome: "ahead" | "stale" | "probe-errored", ... }`. "stale"
 * means at least one probe answered and the answer was "current" every time it
 * did; "probe-errored" means no probe answered at all, which is a different
 * fact and is reported as one.
 */
async function waitForRegistry({
  attempts = DEFAULTS.attempts,
  intervalMs = DEFAULTS.intervalMs,
  probe = probeRegistry,
  sleep = sleepFor,
  log = (line) => console.log(line),
}) {
  let answered = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const comparison = await probe();
      answered += 1;
      if (comparison.ahead === true) {
        log(
          `The registry serves a newer set than the pins: ${JSON.stringify(comparison)}`
        );
        return { outcome: "ahead", comparison, attempt };
      }
      log(
        `The registry still serves the pinned version (attempt ${attempt} of ${attempts}): ${JSON.stringify(comparison)}`
      );
    } catch (error) {
      log(
        `The registry probe failed (attempt ${attempt} of ${attempts}): ${error.message}`
      );
    }
    if (attempt < attempts) {
      log(`Retrying in ${intervalMs / SECOND} s.`);
      await sleep(intervalMs);
    }
  }
  return {
    outcome: answered === 0 ? "probe-errored" : "stale",
    attempts,
    answered,
  };
}

async function main({
  argv = process.argv.slice(2),
  env = process.env,
  runGh: gh = runGh,
  probe = probeRegistry,
  sleep = sleepFor,
  log = (line) => console.log(line),
  now = Date.now,
} = {}) {
  const options = parseArgs(argv);
  const finish = (ready, outcome) => {
    setOutput("ready", String(ready), env);
    setOutput("outcome", outcome, env);
    return { ready, outcome };
  };

  const event = env.GITHUB_EVENT_NAME;
  if (event !== "push") {
    log(
      `A ${event ?? "local"} run has no Release Vale run to wait for; detect runs against whatever the registry serves.`
    );
    return finish(true, "skipped");
  }

  const sha = env.GITHUB_SHA;
  if (!sha) {
    throw new Error("GITHUB_SHA must be set on a push");
  }

  const release = await waitForReleaseRun({
    sha,
    workflow: options.workflow,
    timeoutMs: options.timeoutMs,
    intervalMs: options.pollMs,
    runGh: gh,
    sleep,
    log,
    now,
  });
  if (release.outcome === "failed") {
    log(
      `::warning::the Release Vale run for ${sha} did not succeed (${describeRuns(release.runs)}); nothing to upgrade to yet. The daily schedule will retry once a publish lands.`
    );
    return finish(false, "publish-failed");
  }
  if (release.outcome === "timeout") {
    log(
      `::warning::gave up waiting for the Release Vale run for ${sha} after ${options.timeoutMs / MINUTE} minutes (${release.detail}). The daily schedule will retry.`
    );
    return finish(false, "publish-unfinished");
  }
  log(`Release Vale succeeded for ${sha}.`);

  const registry = await waitForRegistry({
    attempts: options.attempts,
    intervalMs: options.intervalMs,
    probe,
    sleep,
    log,
  });
  if (registry.outcome === "ahead") {
    return finish(true, "ahead");
  }
  if (registry.outcome === "stale") {
    log(
      `::warning::no probe in ${registry.attempts} attempts after the publish succeeded reported a newer set than the pins; each attempt is logged above with its result. The daily schedule will retry.`
    );
    return finish(false, "registry-stale");
  }
  log(
    `::warning::every one of ${registry.attempts} registry probes failed after the publish succeeded; the detect step runs the same read next and fails the run if it persists.`
  );
  return finish(true, "probe-errored");
}

// Exported so vale-upgrade-wait.test.cjs can drive each wait with `gh`, the
// probe, and the clock replaced, and main() end to end the same way.
module.exports = {
  DEFAULTS,
  main,
  parseArgs,
  parseRuns,
  waitForRegistry,
  waitForReleaseRun,
};

if (require.main === module) {
  main().catch((error) => {
    // Still exit 0. A wait that cannot run must not also suppress the
    // upgrade, so the detect step is told to go ahead — the behaviour before
    // the wait existed — and the failure is a warning in the log.
    console.log(
      `::warning::vale-upgrade-wait failed: ${error.message}; running detect without waiting.`
    );
    setOutput("ready", "true");
    setOutput("outcome", "wait-errored");
  });
}
