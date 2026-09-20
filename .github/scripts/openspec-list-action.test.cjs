// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for `.github/actions/openspec-list/run.sh`, the script behind the
 * `openspec-list` composite action.
 *
 * The action is a shell script, so the test runs the script. Each case puts
 * a stub `node` at the front of PATH that behaves one way (prints a listing,
 * writes to stderr while exiting zero, exits non-zero, prints something that
 * is not a listing) and asserts on the `ok`, `changes` and `error` lines the
 * script appends to a temporary $GITHUB_OUTPUT. The stub records its
 * arguments so the test can also confirm which command the script ran.
 *
 * Stubbing PATH rather than passing the command in is deliberate: the script
 * has no test-only seam, so what runs here is exactly what runs in the
 * action, `jq` included. `jq` is on every hosted runner image and is already
 * a hard dependency of the three calling workflows.
 *
 * Every case also asserts the script exited zero. That is the property the
 * action exists to provide: none of its callers may fail a check because the
 * listing failed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPT = resolve(__dirname, "../actions/openspec-list/run.sh");

/**
 * Run the script with a stub `node` whose body is `stubBody` (a bash
 * fragment). Returns the process result plus the parsed $GITHUB_OUTPUT and
 * the arguments the stub was called with.
 */
function runWith(stubBody) {
  const dir = mkdtempSync(join(tmpdir(), "openspec-list-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const argsFile = join(dir, "args");
  writeFileSync(
    join(bin, "node"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n${stubBody}\n`,
    { mode: 0o755 }
  );
  const output = join(dir, "output");
  writeFileSync(output, "");

  const result = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: output,
    },
    encoding: "utf8",
  });

  const outputs = {};
  for (const line of readFileSync(output, "utf8").split("\n")) {
    if (line === "") continue;
    const eq = line.indexOf("=");
    assert.notEqual(eq, -1, `output line has no '=': ${line}`);
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }

  let args = [];
  try {
    args = readFileSync(argsFile, "utf8")
      .split("\n")
      .filter((a) => a !== "");
  } catch {
    // The stub never ran; the caller's assertions will say so.
  }

  return { result, outputs, args };
}

test("runs openspec-tracking.cjs --list from the workspace", () => {
  const { result, args } = runWith(`echo '[]'`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(args, [".github/scripts/openspec-tracking.cjs", "--list"]);
});

test("a listing that succeeds reports ok=true and the compact array", () => {
  const { result, outputs } = runWith(
    `printf '[\\n  "alpha-change",\\n  "beta change"\\n]\\n'`
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outputs, {
    ok: "true",
    changes: '["alpha-change","beta change"]',
    error: "",
  });
});

test("an empty listing is ok=true with an empty array, not a failure", () => {
  const { result, outputs } = runWith(`echo '[]'`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outputs, { ok: "true", changes: "[]", error: "" });
});

test("stderr noise on a zero exit does not pollute the captured value", () => {
  // The `2>&1` defect: node writes a startup warning and still exits zero.
  const { result, outputs } = runWith(
    `echo '(node:1) Warning: something at startup' >&2\necho '["alpha-change"]'`
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outputs, {
    ok: "true",
    changes: '["alpha-change"]',
    error: "",
  });
});

test("a non-zero exit reports ok=false with the status and stderr, and still exits zero", () => {
  const { result, outputs } = runWith(
    `echo 'openspec-tracking failed: EACCES: permission denied' >&2\necho 'partial' \nexit 1`
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs.ok, "false");
  assert.equal(outputs.changes, "");
  assert.equal(
    outputs.error,
    "exit status 1: openspec-tracking failed: EACCES: permission denied"
  );
});

test("a multi-line stderr is collapsed to one output line", () => {
  const { result, outputs } = runWith(
    `printf 'line one\\nline two\\n' >&2\nexit 2`
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs.ok, "false");
  assert.equal(outputs.error, "exit status 2: line one line two");
  assert.ok(!outputs.error.includes("\n"));
});

test("a non-zero exit with nothing on stderr still names the status", () => {
  const { result, outputs } = runWith(`exit 3`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outputs, {
    ok: "false",
    changes: "",
    error: "exit status 3:",
  });
});

test("a zero exit whose stdout is not JSON reports ok=false", () => {
  const { result, outputs } = runWith(`echo 'not json'`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs.ok, "false");
  assert.equal(outputs.changes, "");
  assert.match(
    outputs.error,
    /^listing did not parse as a JSON array of strings/
  );
});

test("a zero exit whose stdout is JSON but not an array of strings reports ok=false", () => {
  // Valid JSON of the wrong shape must not reach a consumer's `jq -r '.[]'`.
  for (const body of [`echo '{"a":1}'`, `echo '[1,2]'`, `echo '"alpha"'`]) {
    const { result, outputs } = runWith(body);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.ok, "false", body);
    assert.equal(outputs.changes, "", body);
    assert.match(outputs.error, /^listing did not parse/, body);
  }
});

test("a missing node on PATH is a listing failure, not a script failure", () => {
  // No stub at all: PATH is emptied down to the directory holding jq and
  // the coreutils, so `node` is not found. `command not found` is exit 127.
  const dir = mkdtempSync(join(tmpdir(), "openspec-list-"));
  const output = join(dir, "output");
  writeFileSync(output, "");
  const jq = spawnSync("bash", ["-c", "command -v jq"], {
    encoding: "utf8",
  }).stdout.trim();
  assert.ok(jq, "jq is required on PATH for this suite");
  const result = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    env: {
      PATH: [resolve(jq, ".."), "/usr/bin", "/bin"].join(":"),
      GITHUB_OUTPUT: output,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(output, "utf8");
  assert.match(text, /^ok=false$/m);
  assert.match(text, /^error=exit status 127: /m);
});

test("refuses to run without GITHUB_OUTPUT", () => {
  // The one path that does exit non-zero: there is nowhere to report to, so
  // silence would be the failure. This cannot happen on a runner, where the
  // variable is always set.
  const dir = mkdtempSync(join(tmpdir(), "openspec-list-"));
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  const result = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GITHUB_OUTPUT must be set/);
});
