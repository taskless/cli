// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for vale-upgrade-wait.cjs — the two waits between the manifest push
 * and the upgrade's registry read.
 *
 * The property under test is the one the workflow promises in its comments:
 * no outcome here fails the run. So every case asserts on the warning and on
 * the `ready` output, and the cases that matter most are the ones a stubbed
 * `gh` that only varied its ANSWER would never reach — a `gh` that errors, and
 * a probe that throws. Time is a fake clock advanced by the injected `sleep`,
 * so the 25-minute bound costs nothing to hit.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  DEFAULTS,
  main,
  parseArgs,
  parseRuns,
  probeRegistry,
  recover,
  runGh,
  waitForRegistry,
  waitForReleaseRun,
} = require("./vale-upgrade-wait.cjs");

const SCRIPT = join(__dirname, "vale-upgrade-wait.cjs");

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A fake clock: `sleep` advances it instead of waiting. */
function clock() {
  let at = 1_000_000;
  const slept = [];
  return {
    now: () => at,
    sleep: async (ms) => {
      slept.push(ms);
      at += ms;
    },
    slept,
  };
}

/**
 * A `gh` that answers from a script of results in order and repeats the last
 * one. An Error entry is thrown, which is how the real runner reports a
 * non-zero exit.
 */
function ghScript(results) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    if (result instanceof Error) {
      throw result;
    }
    return JSON.stringify(result);
  };
  return { gh, calls };
}

/** A probe answering from a script the same way. */
function probeScript(results) {
  let calls = 0;
  const probe = async () => {
    const result = results[Math.min(calls, results.length - 1)];
    calls += 1;
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { probe, count: () => calls };
}

const queued = { status: "queued", conclusion: null };
const inProgress = { status: "in_progress", conclusion: null };
const succeeded = { status: "completed", conclusion: "success" };
const failed = { status: "completed", conclusion: "failure" };

const stale = { pinned: "3.21.0-1", upstream: "3.21.0-1", ahead: false };
const ahead = { pinned: "3.21.0-1", upstream: "3.22.0-2", ahead: true };

test("parseRuns reads gh's JSON and tolerates a null conclusion", () => {
  assert.deepEqual(parseRuns("[]"), []);
  assert.deepEqual(parseRuns("\n"), []);
  assert.deepEqual(parseRuns(JSON.stringify([inProgress, succeeded])), [
    { status: "in_progress", conclusion: "" },
    { status: "completed", conclusion: "success" },
  ]);
  assert.throws(() => parseRuns("{}"), /not an array/);
});

test("parseArgs scales the flags into milliseconds and keeps the defaults", () => {
  assert.deepEqual(parseArgs([]), {
    workflow: "release-vale.yml",
    timeoutMs: DEFAULTS.timeoutMs,
    pollMs: DEFAULTS.pollMs,
    attempts: DEFAULTS.attempts,
    intervalMs: DEFAULTS.intervalMs,
    callTimeoutMs: DEFAULTS.callTimeoutMs,
  });
  const options = parseArgs([
    "--workflow",
    "other.yml",
    "--timeout-minutes",
    "2",
    "--poll-seconds",
    "5",
    "--attempts",
    "3",
    "--interval-seconds",
    "10",
    "--call-timeout-seconds",
    "7",
  ]);
  assert.equal(options.callTimeoutMs, 7_000);
  assert.equal(options.workflow, "other.yml");
  assert.equal(options.timeoutMs, 120_000);
  assert.equal(options.pollMs, 5_000);
  assert.equal(options.attempts, 3);
  assert.equal(options.intervalMs, 10_000);
  assert.throws(() => parseArgs(["--attempts"]), /needs a value/);
  assert.throws(() => parseArgs(["--attempts", "0"]), /positive number/);
});

test("release run: registers late, then succeeds", async () => {
  const time = clock();
  const { gh, calls } = ghScript([[], [], [queued], [inProgress], [succeeded]]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(calls.length, 5);
  assert.deepEqual(time.slept, Array(4).fill(DEFAULTS.pollMs));
  // Exact commit, this workflow, push event: a run for another manifest commit
  // still draining must never be mistaken for this one.
  assert.deepEqual(calls[0], [
    "run",
    "list",
    "--workflow",
    "release-vale.yml",
    "--event",
    "push",
    "--commit",
    SHA,
    "--json",
    "status,conclusion",
  ]);
});

test("release run: a failed run is reported, not waited on further", async () => {
  const time = clock();
  const { gh } = ghScript([[inProgress], [failed]]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.runs, [
    { status: "completed", conclusion: "failure" },
  ]);
});

test("release run: a run that never registers times out at the bound", async () => {
  const time = clock();
  const { gh, calls } = ghScript([[]]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.detail, "no run found");
  // 25 minutes at 30 s: fifty sleeps, fifty-one polls, and the total slept
  // time is exactly the bound.
  assert.equal(time.slept.length, 50);
  assert.equal(calls.length, 51);
  assert.equal(
    time.slept.reduce((sum, ms) => sum + ms, 0),
    DEFAULTS.timeoutMs
  );
});

test("release run: gh errors twice, then the run is found and succeeds", async () => {
  const time = clock();
  const logged = [];
  const { gh } = ghScript([
    new Error("gh run list failed: HTTP 502"),
    new Error("gh run list failed: API rate limit exceeded"),
    [succeeded],
  ]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: (line) => logged.push(line),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(time.slept.length, 2);
  assert.match(logged[0], /HTTP 502; treating as not yet registered/);
  assert.match(
    logged[1],
    /rate limit exceeded; treating as not yet registered/
  );
});

test("release run: gh that always errors is a timeout naming the error", async () => {
  const time = clock();
  const { gh } = ghScript([new Error("gh run list failed: HTTP 503")]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "timeout");
  assert.match(result.detail, /the last gh call failed: .*HTTP 503/);
  assert.equal(time.slept.length, 50);
});

test("release run: a stale earlier answer does not survive a gh error", async () => {
  // Registered and in progress, then gh breaks for good: the timeout must say
  // gh failed, not describe the run it saw before it did.
  const time = clock();
  const { gh } = ghScript([[inProgress], new Error("gh run list failed: 500")]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "timeout");
  assert.deepEqual(result.runs, []);
  assert.match(result.detail, /the last gh call failed/);
});

test("release run: waits while any run for the commit is still going", async () => {
  const time = clock();
  const { gh } = ghScript([
    [succeeded, inProgress],
    [succeeded, succeeded],
  ]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: () => {},
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(time.slept.length, 1);
});

test("registry: ahead after two stale probes", async () => {
  const time = clock();
  const { probe, count } = probeScript([stale, stale, ahead]);
  const result = await waitForRegistry({
    probe,
    sleep: time.sleep,
    log: () => {},
  });
  assert.equal(result.outcome, "ahead");
  assert.equal(result.attempt, 3);
  assert.deepEqual(result.comparison, ahead);
  assert.equal(count(), 3);
  assert.deepEqual(time.slept, [DEFAULTS.intervalMs, DEFAULTS.intervalMs]);
});

test("registry: a probe that throws every time is 'probe-errored', not 'stale'", async () => {
  const time = clock();
  const logged = [];
  const { probe, count } = probeScript([
    new Error("GET https://registry.npmjs.org/x responded 503"),
  ]);
  const result = await waitForRegistry({
    probe,
    sleep: time.sleep,
    log: (line) => logged.push(line),
  });
  assert.equal(result.outcome, "probe-errored");
  assert.equal(result.answered, 0);
  assert.equal(count(), DEFAULTS.attempts);
  // Four sleeps between five attempts; no pointless wait after the last.
  assert.equal(time.slept.length, DEFAULTS.attempts - 1);
  assert.equal(
    logged.filter((line) =>
      /probe failed \(attempt \d of 5\): .*503/.test(line)
    ).length,
    DEFAULTS.attempts
  );
});

test("registry: never ahead is 'stale'", async () => {
  const time = clock();
  const { probe } = probeScript([stale]);
  const result = await waitForRegistry({
    probe,
    sleep: time.sleep,
    log: () => {},
  });
  assert.equal(result.outcome, "stale");
  assert.equal(result.answered, DEFAULTS.attempts);
});

test("registry: one answer among errors is still 'stale'", async () => {
  const time = clock();
  const { probe } = probeScript([
    new Error("503"),
    stale,
    new Error("503"),
    new Error("503"),
    new Error("503"),
  ]);
  const result = await waitForRegistry({
    probe,
    sleep: time.sleep,
    log: () => {},
  });
  assert.equal(result.outcome, "stale");
  assert.equal(result.answered, 1);
});

/** Drive main() with everything injected and read back $GITHUB_OUTPUT. */
async function run({ event = "push", gh, probe, argv = [] }) {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-wait-test-"));
  const outputPath = join(directory, "github-output");
  const time = clock();
  const logged = [];
  try {
    const result = await main({
      argv,
      env: {
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: SHA,
        GITHUB_OUTPUT: outputPath,
      },
      runGh: gh ?? ghScript([[succeeded]]).gh,
      probe: probe ?? probeScript([ahead]).probe,
      sleep: time.sleep,
      now: time.now,
      log: (line) => logged.push(line),
    });
    let outputs = {};
    try {
      outputs = Object.fromEntries(
        readFileSync(outputPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("="))
      );
    } catch {
      // nothing written
    }
    return {
      result,
      outputs,
      logged,
      warnings: logged.filter((line) => line.startsWith("::warning::")),
      slept: time.slept,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("main: publish succeeded and the registry is ahead -> ready=true", async () => {
  const { outputs, warnings } = await run({
    gh: ghScript([[], [inProgress], [succeeded]]).gh,
    probe: probeScript([stale, ahead]).probe,
  });
  assert.deepEqual(outputs, { ready: "true", outcome: "ahead" });
  assert.deepEqual(warnings, []);
});

test("main: publish failed -> warning, ready=false, registry never probed", async () => {
  const probed = probeScript([ahead]);
  const { outputs, warnings } = await run({
    gh: ghScript([[failed]]).gh,
    probe: probed.probe,
  });
  assert.deepEqual(outputs, { ready: "false", outcome: "publish-failed" });
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    new RegExp(
      `Release Vale run for ${SHA} did not succeed \\(completed/failure\\)`
    )
  );
  assert.match(warnings[0], /daily schedule will retry/);
  assert.equal(probed.count(), 0);
});

test("main: publish never registers -> warning after the bound, ready=false", async () => {
  const { outputs, warnings, slept } = await run({
    gh: ghScript([[]]).gh,
  });
  assert.deepEqual(outputs, { ready: "false", outcome: "publish-unfinished" });
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /gave up waiting .* after 25 minutes \(no run found\)/
  );
  assert.equal(slept.length, 50);
});

test("main: gh errors twice, then succeeds -> no warning", async () => {
  const { outputs, warnings } = await run({
    gh: ghScript([new Error("502"), new Error("502"), [succeeded]]).gh,
  });
  assert.deepEqual(outputs, { ready: "true", outcome: "ahead" });
  assert.deepEqual(warnings, []);
});

test("main: gh always errors -> warning naming the error, ready=false", async () => {
  const { outputs, warnings } = await run({
    gh: ghScript([new Error("gh run list failed: HTTP 503")]).gh,
  });
  assert.deepEqual(outputs, { ready: "false", outcome: "publish-unfinished" });
  assert.match(warnings[0], /the last gh call failed: .*HTTP 503/);
});

test("main: registry ahead after two probes -> ready=true", async () => {
  const { outputs, warnings, slept } = await run({
    probe: probeScript([stale, ahead]).probe,
  });
  assert.deepEqual(outputs, { ready: "true", outcome: "ahead" });
  assert.deepEqual(warnings, []);
  assert.deepEqual(slept, [DEFAULTS.intervalMs]);
});

test("main: probe throws every time -> warning, but ready=true so detect fails loudly", async () => {
  const { outputs, warnings } = await run({
    probe: probeScript([new Error("503")]).probe,
  });
  assert.deepEqual(outputs, { ready: "true", outcome: "probe-errored" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /every one of 5 registry probes failed/);
  assert.match(warnings[0], /detect step runs the same read next/);
});

test("main: probe never ahead -> warning, ready=false", async () => {
  const { outputs, warnings } = await run({
    probe: probeScript([stale]).probe,
  });
  assert.deepEqual(outputs, { ready: "false", outcome: "registry-stale" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no probe in 5 attempts .* reported a newer set/);
});

test("main: a non-push event skips both waits with ready=true", async () => {
  for (const event of ["schedule", "workflow_dispatch"]) {
    const gh = ghScript([[]]);
    const probed = probeScript([stale]);
    const { outputs, warnings, slept } = await run({
      event,
      gh: gh.gh,
      probe: probed.probe,
    });
    assert.deepEqual(outputs, { ready: "true", outcome: "skipped" });
    assert.deepEqual(warnings, []);
    assert.equal(gh.calls.length, 0);
    assert.equal(probed.count(), 0);
    assert.deepEqual(slept, []);
  }
});

test("main: flags shorten the bounds", async () => {
  const { slept, outputs } = await run({
    argv: ["--timeout-minutes", "1", "--poll-seconds", "20", "--attempts", "2"],
    gh: ghScript([[]]).gh,
  });
  assert.deepEqual(outputs, { ready: "false", outcome: "publish-unfinished" });
  assert.deepEqual(slept, [20_000, 20_000, 20_000]);
});

test("recover: a thrown error is a warning and ready=true, never a failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-wait-test-"));
  const outputPath = join(directory, "github-output");
  const logged = [];
  try {
    recover(new Error("GITHUB_SHA must be set on a push"), {
      env: { GITHUB_OUTPUT: outputPath },
      log: (line) => logged.push(line),
    });
    assert.match(logged[0], /^::warning::vale-upgrade-wait failed: GITHUB_SHA/);
    assert.equal(
      readFileSync(outputPath, "utf8"),
      "ready=true\noutcome=wait-errored\n"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recover: an unwritable GITHUB_OUTPUT is a second warning, not a throw", () => {
  const logged = [];
  assert.doesNotThrow(() =>
    recover(new Error("boom"), {
      env: { GITHUB_OUTPUT: join(tmpdir(), "does-not-exist", "x", "output") },
      log: (line) => logged.push(line),
    })
  );
  assert.equal(logged.length, 2);
  assert.match(logged[1], /^::warning::could not write GITHUB_OUTPUT/);
});

/**
 * The real entry point, spawned. Everything above drives the exports; this is
 * the one test of the `require.main === module` wiring, and it is the property
 * the script exists for: a run that cannot even start still exits 0.
 */
function spawnScript(env, argv = []) {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-wait-test-"));
  const outputPath = join(directory, "github-output");
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...argv], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputPath, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputs = "";
    try {
      outputs = readFileSync(outputPath, "utf8");
    } catch {
      // nothing written
    }
    return { stdout, outputs };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("entry point: GITHUB_SHA missing on a push exits 0 with ready=true", () => {
  // execFileSync throws on a non-zero exit, so reaching the assertions is the
  // exit-code check.
  const { stdout, outputs } = spawnScript({ GITHUB_EVENT_NAME: "push" });
  assert.match(
    stdout,
    /::warning::vale-upgrade-wait failed: GITHUB_SHA must be set on a push; running detect without waiting\./
  );
  assert.equal(outputs, "ready=true\noutcome=wait-errored\n");
});

test("entry point: a malformed flag exits 0 with ready=true", () => {
  const { stdout, outputs } = spawnScript({ GITHUB_EVENT_NAME: "push" }, [
    "--attempts",
    "0",
  ]);
  assert.match(stdout, /--attempts needs a positive number, got 0/);
  assert.equal(outputs, "ready=true\noutcome=wait-errored\n");
});

/** A child that never exits on its own, for the per-call timeout tests. */
const HANG = "setTimeout(() => {}, 30_000)";

test("runGh: a call that hangs is killed at the bound and thrown as a failure", () => {
  const started = Date.now();
  assert.throws(
    () => runGh(["-e", HANG], { command: process.execPath, timeoutMs: 300 }),
    /failed: timed out after 0\.3 s/
  );
  // Killed at the bound, not at the child's own 30 s.
  assert.ok(Date.now() - started < 5_000);
});

test("probeRegistry: a probe that hangs is a thrown failure, not a stall", () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-wait-test-"));
  const script = join(directory, "hang.cjs");
  writeFileSync(script, `${HANG};\n`);
  try {
    assert.throws(
      () => probeRegistry({ script, timeoutMs: 300 }),
      /registry probe timed out after 0\.3 s/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release run: a timed-out gh call is polled again like any failed call", async () => {
  const time = clock();
  const logged = [];
  const { gh, calls } = ghScript([
    new Error("gh run list failed: timed out after 60 s"),
    [succeeded],
  ]);
  const result = await waitForReleaseRun({
    sha: SHA,
    runGh: gh,
    sleep: time.sleep,
    now: time.now,
    log: (line) => logged.push(line),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(calls.length, 2);
  assert.match(
    logged[0],
    /timed out after 60 s; treating as not yet registered/
  );
});

test("registry: a timed-out probe counts as a failed probe", async () => {
  const time = clock();
  const logged = [];
  const { probe } = probeScript([
    new Error("the registry probe timed out after 60 s"),
    ahead,
  ]);
  const result = await waitForRegistry({
    probe,
    sleep: time.sleep,
    log: (line) => logged.push(line),
  });
  assert.equal(result.outcome, "ahead");
  assert.equal(result.attempt, 2);
  assert.match(logged[0], /probe failed \(attempt 1 of 5\): .*timed out/);
});

test("main: the call timeout reaches gh and the probe as a second argument", async () => {
  const seen = { gh: [], probe: [] };
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-wait-test-"));
  try {
    await main({
      argv: ["--call-timeout-seconds", "9"],
      env: {
        GITHUB_EVENT_NAME: "push",
        GITHUB_SHA: SHA,
        GITHUB_OUTPUT: join(directory, "github-output"),
      },
      runGh: (args, options) => {
        seen.gh.push(options);
        return JSON.stringify([succeeded]);
      },
      probe: async (options) => {
        seen.probe.push(options);
        return ahead;
      },
      sleep: async () => {},
      log: () => {},
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(seen.gh, [{ timeoutMs: 9_000 }]);
  assert.deepEqual(seen.probe, [{ timeoutMs: 9_000 }]);
});
