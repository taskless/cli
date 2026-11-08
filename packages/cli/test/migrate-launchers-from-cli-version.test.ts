import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import migration from "../src/filesystem/migrations/0013-launchers-from-cli-version";

const RELEASE = "@taskless/cli";
const NIGHTLY = "@taskless/cli-nightly";

/**
 * Migration 0013 moves a legacy `install.cliVersion` into `install.launchers`,
 * so the CLI and the launcher template read `launchers` alone.
 */
describe("migration 0013 records a legacy cliVersion in launchers", () => {
  let directory: string;
  let taskless: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-0013-"));
    taskless = join(directory, ".taskless");
    await mkdir(taskless, { recursive: true });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function seed(manifest: unknown): Promise<void> {
    await writeFile(
      join(taskless, "taskless.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
      "utf8"
    );
  }

  async function manifestText(): Promise<string> {
    return readFile(join(taskless, "taskless.json"), "utf8");
  }

  async function migratedInstall(
    install: Record<string, unknown>
  ): Promise<unknown> {
    await seed({ version: 12, install });
    await migration(taskless);
    return (JSON.parse(await manifestText()) as { install: unknown }).install;
  }

  it.each([
    ["a release", "0.13.0", RELEASE],
    ["a published nightly", "0.14.0-20261020120000xabc1234", NIGHTLY],
    ["a build:next nightly", "0.13.0-next-fa9ae7c", NIGHTLY],
  ])(
    "moves %s under the package that published it",
    async (_, cliVersion, packageName) => {
      expect(await migratedInstall({ cliVersion })).toEqual({
        cliVersion,
        launchers: { [packageName]: cliVersion },
      });
    }
  );

  it("records nothing for a self build, which no package publishes", async () => {
    await seed({ version: 12, install: { cliVersion: "0.13.0-self" } });
    const before = await manifestText();
    await migration(taskless);
    expect(await manifestText()).toBe(before);
  });

  it("records nothing for a value that is not a version", async () => {
    for (const cliVersion of ["latest", 7, ""]) {
      expect(await migratedInstall({ cliVersion })).toEqual({ cliVersion });
    }
  });

  it("leaves a manifest that already records a launcher alone", async () => {
    // `launchers` is already the record, so a stale cliVersion beside it is
    // display only and must not be added as a second package's version.
    const install = {
      cliVersion: "0.14.0-20261020120000xabc1234",
      launchers: { [RELEASE]: "0.13.0" },
    };
    expect(await migratedInstall(install)).toEqual(install);
  });

  it("preserves every other field, and launchers entries it cannot read", async () => {
    await seed({
      version: 12,
      install: {
        cliVersion: "0.13.0",
        onboarded: true,
        launchers: { junk: 1 },
        targets: { ".claude": { skills: ["taskless"], mode: "reference" } },
      },
      rules: { reconciledTo: "0.13.0" },
      future: { kept: true },
    });
    await migration(taskless);
    expect(JSON.parse(await manifestText())).toEqual({
      version: 12,
      install: {
        cliVersion: "0.13.0",
        onboarded: true,
        launchers: { junk: 1, [RELEASE]: "0.13.0" },
        targets: { ".claude": { skills: ["taskless"], mode: "reference" } },
      },
      rules: { reconciledTo: "0.13.0" },
      future: { kept: true },
    });
  });

  it("is idempotent, so a crash after the write replays as a no-op", async () => {
    await migratedInstall({ cliVersion: "0.13.0" });
    const once = await manifestText();
    await migration(taskless);
    expect(await manifestText()).toBe(once);
  });

  it("does nothing to a missing, unparseable, or install-less manifest", async () => {
    await expect(migration(taskless)).resolves.toBeUndefined();

    await seed("{ not json");
    await migration(taskless);
    expect(await manifestText()).toBe("{ not json");

    await seed({ version: 12 });
    await migration(taskless);
    expect(JSON.parse(await manifestText())).toEqual({ version: 12 });
  });

  it("runs as part of upgrading a version-12 scaffold", async () => {
    await seed({ version: 12, install: { cliVersion: "0.13.0" } });

    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    const manifest = JSON.parse(await manifestText()) as {
      version: number;
      install: { launchers?: Record<string, string> };
    };
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
    expect(manifest.install.launchers).toEqual({ [RELEASE]: "0.13.0" });
  });
});
