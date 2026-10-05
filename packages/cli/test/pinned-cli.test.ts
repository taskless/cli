import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findStalePins, getPinnedCliNotice } from "../src/install/pinned-cli";

describe("findStalePins", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-pinned-cli-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function writePackage(contents: unknown): Promise<void> {
    await writeFile(join(cwd, "package.json"), JSON.stringify(contents));
  }

  it("finds nothing without a package.json", async () => {
    expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
  });

  it("finds nothing in a package.json that is not JSON", async () => {
    // Advice on a successful install; the package manager reports this.
    await writeFile(join(cwd, "package.json"), "{ not json");
    expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
  });

  it.each([
    ["0.10.2", true],
    ["=0.10.2", true],
    ["v0.11.1", true],
    ["0.11.2", false],
    ["0.12.0", false],
    // Pre-1.0 caret holds the minor, so `^0.10.2` never reaches 0.11.
    ["^0.10.2", true],
    ["^0.11.0", false],
    ["~0.10.9", true],
    ["~0.11.0", false],
    // A nightly carries the same layout as its release.
    ["0.11.2-20260901000000xabcdef0", false],
    ["0.11.1-20260901000000xabcdef0", true],
    // Unbounded or unknowable: not reported, since a guess is a notice an
    // agent learns to skip.
    ["latest", false],
    ["*", false],
    [">=0.10.0", false],
    ["workspace:*", false],
    ["github:taskless/cli", false],
  ])("a devDependency of %s is stale: %s", async (spec, stale) => {
    await writePackage({ devDependencies: { "@taskless/cli": spec } });
    const pins = await findStalePins(cwd, "0.11.2");
    expect(pins).toEqual(
      stale
        ? [{ location: "devDependencies", name: "@taskless/cli", spec }]
        : []
    );
  });

  it("reads every dependency field and the nightly package name", async () => {
    await writePackage({
      dependencies: { "@taskless/cli": "0.9.0" },
      optionalDependencies: { "@taskless/cli-nightly": "0.10.0-2026x0" },
      peerDependencies: { "@taskless/cli": "0.9.0" },
    });
    expect(await findStalePins(cwd, "0.11.2")).toEqual([
      { location: "dependencies", name: "@taskless/cli", spec: "0.9.0" },
      {
        location: "optionalDependencies",
        name: "@taskless/cli-nightly",
        spec: "0.10.0-2026x0",
      },
    ]);
  });

  it("finds a version spelled out in a script, and leaves @latest alone", async () => {
    await writePackage({
      scripts: {
        lint: "eslint . && npx @taskless/cli@0.10.2 check",
        nightly: "pnpm dlx @taskless/cli-nightly@0.10.0-2026x0 check",
        fresh: "npx @taskless/cli@latest check",
        bare: "taskless check",
        current: "npx @taskless/cli@0.11.2 check",
      },
    });
    expect(await findStalePins(cwd, "0.11.2")).toEqual([
      { location: "scripts.lint", name: "@taskless/cli", spec: "0.10.2" },
      {
        location: "scripts.nightly",
        name: "@taskless/cli-nightly",
        spec: "0.10.0-2026x0",
      },
    ]);
  });
});

describe("getPinnedCliNotice", () => {
  it("is absent when nothing is stale", () => {
    expect(getPinnedCliNotice([], "0.11.2")).toBeUndefined();
  });

  it("names every pin and offers the bump rather than claiming it", () => {
    const notice = getPinnedCliNotice(
      [
        { location: "devDependencies", name: "@taskless/cli", spec: "^0.10.2" },
        { location: "scripts.lint", name: "@taskless/cli", spec: "0.10.2" },
      ],
      "0.11.2"
    );
    expect(notice).toContain("devDependencies: @taskless/cli ^0.10.2");
    expect(notice).toContain("scripts.lint: @taskless/cli 0.10.2");
    expect(notice).toContain("Offer to update them to 0.11.2");
  });

  it("hedges without a migration: the layout the pin reads did not move", () => {
    const notice = getPinnedCliNotice(
      [{ location: "devDependencies", name: "@taskless/cli", spec: "0.10.2" }],
      "0.11.2"
    );
    expect(notice).toContain("will likely fail");
    expect(notice).not.toContain("SCAFFOLD_VERSION_MISMATCH");
  });

  it("states the breakage as certain after a migration, and ties the bump to the commit", () => {
    // A CLI refuses a scaffold newer than its own highest migration, so the
    // pin fails on CI's first run against the migrated files.
    const notice = getPinnedCliNotice(
      [{ location: "devDependencies", name: "@taskless/cli", spec: "0.10.2" }],
      "0.11.2",
      { migratedTo: 9 }
    );
    expect(notice).toContain("schema version 9");
    expect(notice).toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(notice).toContain("will break");
    expect(notice).toContain("same commit as .taskless/");
    expect(notice).not.toContain("likely");
  });
});
