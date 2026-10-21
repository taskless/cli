import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { inject } from "vitest";

/**
 * This run's snapshot of `dist/`, for tests that read or import built files.
 *
 * Tests never read `dist/` directly: a build that starts mid-run empties it,
 * and every spawn in that window fails as if the CLI had. The snapshot is taken
 * once per run by ./distribution-snapshot.ts, which explains the measurement behind it.
 */
export function builtDirectory(): string {
  return inject("cliDist");
}

/** The built CLI entry, for `execFile("node", [builtCli(), ...])`. */
export function builtCli(): string {
  return join(builtDirectory(), "index.js");
}

/**
 * The version the built CLI reports, for a fixture manifest that records a
 * CLI version without meaning to test the version-pin gate.
 */
export function builtCliVersion(): string {
  return execFileSync("node", [builtCli(), "--version"], {
    encoding: "utf8",
  }).trim();
}
