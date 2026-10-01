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
