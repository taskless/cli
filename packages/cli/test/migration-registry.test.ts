// THE IMPORT ORDER IN THIS FILE IS THE TEST. Do not reorder, and do not let a
// formatter group these differently — see the docblock below.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Entered FIRST, before the runner. A MIGRATION MODULE ITSELF is the entry
// that broke the registry: reached before `migrate.ts`, its own default export
// is still unassigned when the runner (pulled in behind it) builds the record,
// so the registry captures `undefined`. `rule-id-uniqueness.test.ts` imports
// `0009` on its first line for its unit cases, which is the only reason the
// original cycle was ever observed.
import "../src/filesystem/migrations/0009-unique-rule-ids";
// The path a rule write takes to the runner, via `ensureTasklessDirectory`.
import "../src/rules/files";
import {
  LATEST_SCHEMA_VERSION,
  runMigrations,
} from "../src/filesystem/migrate";

/**
 * Every version in the migration registry resolves to a function when the
 * graph is entered through a rule write.
 *
 * THIS ASSERTION WAS SILENTLY FALSE, and nothing reported it. Migration `0009`
 * imported `pathExists` from `rules/reconcile-marker`, which read the manifest
 * from `filesystem/migrate.ts` — the module holding the registry. The cycle
 * left `migrations["9"]` holding `undefined`, and the only symptom was
 * `TypeError: migrate is not a function` thrown from the middle of a rule
 * write. The manifest now lives in `filesystem/manifest.ts` and knows nothing
 * about migrations, so the loop is gone; this is what keeps it gone.
 *
 * STATIC IMPORTS, IN THIS ORDER, AND THAT IS NOT INCIDENTAL. Two earlier
 * versions of this test were measured against a deliberately reintroduced
 * cycle and BOTH PASSED, which is the only reason this one is trusted:
 *
 * 1. `vi.resetModules()` with dynamic `import()`, to exercise several entry
 *    orders from one file. Vite's SSR module transform resolves a dynamic
 *    re-import differently from the hoisted static graph, so the broken order
 *    was never reproduced at all.
 * 2. Static imports, but entered through `rules/files.ts`. Not enough: by then
 *    `migrate.ts` is reached before any migration module, and it builds the
 *    record from fully evaluated imports.
 *
 * What reproduces it is entering at a MIGRATION MODULE first, which is what
 * `rule-id-uniqueness.test.ts` happens to do on its first line. A test for a
 * cycle has to be entered the way the cycle was, and "the suite is green" is
 * not evidence that it would be.
 *
 * Proven by RUNNING the registry rather than inspecting its shape:
 * `runMigrations` reports every version it applied, and a version bound to
 * `undefined` throws on call rather than reaching the `applied` list. That also
 * keeps the registry unexported, since exporting internals to make an assertion
 * possible is the shape of a check in the wrong place.
 */
let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-registry-"));
  // `runMigrations` takes an existing `.taskless/`; creating it is
  // `ensureTasklessDirectory`'s job, and going through that would enter the
  // graph from one more fixed place rather than the one under test.
  await mkdir(join(cwd, ".taskless"), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("the migration registry", () => {
  it("applies every registered version when entered through a rule write", async () => {
    const report = await runMigrations(join(cwd, ".taskless"), {
      onNotice: () => {
        /* silence the scaffold notice */
      },
    });

    expect(report).toBeDefined();
    expect(report?.to).toBe(LATEST_SCHEMA_VERSION);
    // Every version from 1 to the latest ran. A registry entry bound to
    // `undefined` throws when called, so it cannot appear here.
    expect(report?.applied).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => index + 1)
    );
  });
});
