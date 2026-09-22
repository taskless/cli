import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";

/**
 * This repository's own `.taskless/` is on the scaffold version this CLI
 * ships.
 *
 * Migrations run on `init`, `demo`, `onboard`, and rule delivery, and on
 * nothing the development loop invokes: `pnpm lint` builds and runs `check`,
 * which refuses a stale scaffold rather than migrating it. So a pull request
 * that adds a migration can pass every other check while leaving the dogfood
 * tree behind, and the gap only shows when someone's `check` hits the wall.
 * Measured: `install.cliVersion` sat at 0.11.0 from 2026-08-29 until
 * migration 0008 made `check` refuse on 2026-09-21, because nobody had a
 * reason to run `init` here in between.
 *
 * Asserted here, in `Validate`, so the pull request that adds a migration is
 * the one that applies it: run `pnpm build && pnpm cli init` and commit the
 * rewritten `.taskless/`. Deliberately NOT automated into a script. A tracked
 * file rewritten as a side effect of `lint` is the surprise the `check` wall
 * exists to prevent; a red test naming the command is the visible version.
 *
 * Only the schema version is pinned. `install.cliVersion` is the nightly the
 * installed skill was reconciled against and moves on its own schedule.
 */
describe("the repository's own scaffold", () => {
  it("is on the latest schema version", () => {
    const manifestPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      ".taskless",
      "taskless.json"
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: unknown;
    };

    expect(
      manifest.version,
      `.taskless/taskless.json records scaffold version ${String(manifest.version)} ` +
        `but this CLI's latest migration is ${String(LATEST_SCHEMA_VERSION)}. ` +
        `Run \`pnpm build && pnpm cli init\` and commit the rewritten .taskless/.`
    ).toBe(LATEST_SCHEMA_VERSION);
  });
});
