import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import {
  readManifest,
  writeManifest,
  LATEST_SCHEMA_VERSION,
} from "../src/filesystem/migrate";

describe("install-state migrations", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "taskless-migrate-install-")
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("fresh project reaches the latest version with an empty install block", async () => {
    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(
        join(temporaryDirectory, ".taskless", "taskless.json"),
        "utf8"
      )
    ) as { version: number; install: Record<string, unknown> };

    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.install).toEqual({});
  });

  it("forward-migrates a v1 project", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ version: 1 }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number; install: Record<string, unknown> };

    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.install).toEqual({});
  });

  it("drops installedAt but preserves other install fields on re-run", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({
        version: 2,
        install: {
          installedAt: "2026-04-16T00:00:00.000Z",
          cliVersion: "0.5.4",
          targets: { ".claude": { skills: ["taskless-check"] } },
        },
      }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number; install: Record<string, unknown> };

    // Migration 3 strips the unused timestamp; everything else survives.
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.install).toEqual({
      cliVersion: "0.5.4",
      targets: { ".claude": { skills: ["taskless-check"] } },
    });
  });

  it("preserves unknown top-level fields through migrate + write cycle", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({
        version: 1,
        experimental: { flag: true, note: "do not delete" },
      }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as Record<string, unknown>;

    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.install).toEqual({});
    expect(manifest.experimental).toEqual({
      flag: true,
      note: "do not delete",
    });
  });

  it("refuses non-object JSON (e.g. null) rather than re-migrating from 0", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    // Valid JSON, but not a manifest. Reading `.version` off this would throw
    // a bare TypeError if unguarded, and treating it as version 0 has the same
    // consequence as an unparseable file: the next write replaces it.
    await writeFile(join(tasklessDirectory, "taskless.json"), "null", "utf8");

    await expect(ensureTasklessDirectory(temporaryDirectory)).rejects.toThrow(
      /not a JSON object/
    );

    const after = await readFile(
      join(tasklessDirectory, "taskless.json"),
      "utf8"
    );
    expect(after).toBe("null");
  });

  it("migrates a manifest with no version field, preserving what it holds", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    // A readable object with no `version` is NOT the unreadable case. Every
    // write merges over the parsed object, so migrating it from 0 loses
    // nothing, and refusing here would wall off a manifest this CLI
    // understands perfectly well.
    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({ experimental: { keep: "me" } }),
      "utf8"
    );

    await ensureTasklessDirectory(temporaryDirectory);

    const manifest = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as { version: number; experimental: Record<string, unknown> };

    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(manifest.experimental).toEqual({ keep: "me" });
  });

  it("readManifest / writeManifest preserves unknown fields on explicit round-trip", async () => {
    const tasklessDirectory = join(temporaryDirectory, ".taskless");
    await mkdir(tasklessDirectory, { recursive: true });

    await writeFile(
      join(tasklessDirectory, "taskless.json"),
      JSON.stringify({
        version: 2,
        install: { targets: { ".claude": { skills: ["taskless-check"] } } },
        unknown: { keep: "me" },
      }),
      "utf8"
    );

    const { manifest, raw } = await readManifest(tasklessDirectory);
    expect(manifest.version).toBe(2);
    expect(raw.unknown).toEqual({ keep: "me" });

    await writeManifest(tasklessDirectory, manifest, raw);

    const rewritten = JSON.parse(
      await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
    ) as Record<string, unknown>;

    expect(rewritten.unknown).toEqual({ keep: "me" });
    expect(rewritten.install).toEqual({
      targets: { ".claude": { skills: ["taskless-check"] } },
    });
  });
});

describe("migration version matrix", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "taskless-migrate-matrix-")
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  // Seed .taskless/ at every prior schema version and confirm each
  // forward-migrates cleanly to the latest. Catches a future migration that
  // forgets to handle an older starting point.
  // Every prior version, derived. The list used to be written out, so each new
  // migration silently stopped testing the version it had just made "prior".
  const priorVersions = Array.from(
    { length: LATEST_SCHEMA_VERSION },
    (_, index) => index
  );
  for (const startVersion of priorVersions) {
    it(`forward-migrates a v${String(startVersion)} project to the latest schema`, async () => {
      const latest = LATEST_SCHEMA_VERSION;
      const tasklessDirectory = join(temporaryDirectory, ".taskless");
      await mkdir(tasklessDirectory, { recursive: true });
      await writeFile(
        join(tasklessDirectory, "taskless.json"),
        JSON.stringify({ version: startVersion }),
        "utf8"
      );

      await ensureTasklessDirectory(temporaryDirectory);

      const manifest = JSON.parse(
        await readFile(join(tasklessDirectory, "taskless.json"), "utf8")
      ) as { version: number };
      expect(manifest.version).toBe(latest);
    });
  }
});
