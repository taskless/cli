import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import { readManifest } from "../src/filesystem/manifest";
import { reconcileStatus } from "../src/rules/reconcile-status";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

/**
 * This repository's own `.taskless/` is on the scaffold version this CLI
 * ships.
 *
 * Migrations run on `init`, `onboard`, and rule delivery, and on nothing the
 * development loop invokes: `pnpm lint` builds and runs `check`,
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
    const manifestPath = join(repositoryRoot, ".taskless", "taskless.json");
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

/**
 * This repository's own rules are reconciled to the engines this CLI bundles.
 *
 * `pnpm cli` sets `TASKLESS_ALLOW_VERSION_MISMATCHES=1`, which the dev loop
 * needs because a local build is never the version the project records. That
 * override also lifts the engine gate, so `pnpm lint` ran the house-style
 * rules on engines they were never reconciled against, with no refusal.
 * Measured: recorded at ast-grep 0.45.2 and Vale 3.18.0 from 2026-08-29 while
 * the CLI bundled 0.51.0 and 3.24.0, with two mechanical rewrites pending.
 *
 * So the PR that bumps an engine is the one that reconciles our rules, the way
 * the scaffold check above makes the PR that adds a migration apply it.
 *
 * Deliberately NOT `reconcile.required`. That is also true whenever the CLI
 * version moves past the marker, which every release does, so asserting it
 * would turn the automatic Version Packages PR red on each release. An engine
 * bump is where rule matching actually changes, and recording it with
 * `update --rules` also stamps the walk.
 */
describe("the repository's own rules", () => {
  it("are reconciled to the bundled engines", async () => {
    const { manifest } = await readManifest(join(repositoryRoot, ".taskless"));
    const status = await reconcileStatus(repositoryRoot, manifest.rules);
    const moved = status.engines
      .map(
        ({ engine, recorded, bundled }) => `${engine} ${recorded} -> ${bundled}`
      )
      .join(", ");

    expect(
      { engines: status.engines, ruleMigrations: status.ruleMigrations },
      `.taskless/taskless.json records the rules against engines this CLI does not bundle (${moved}). ` +
        "Run `pnpm build`, walk `pnpm cli agent update`, then `pnpm cli update --rules`, " +
        "and commit the rewritten .taskless/."
    ).toEqual({ engines: [], ruleMigrations: [] });
  });
});
