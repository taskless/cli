import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Migration } from "../types";
import { isRecord } from "../../util/is-record";

const MANIFEST_FILE = "taskless.json";

/**
 * Migration 3 — drop the unused `install.installedAt` timestamp.
 *
 * The timestamp was written on every install but never read, so it only
 * produced spurious diffs in committed manifests (e.g. on `pnpm build:self`).
 * Idempotent: a manifest already lacking the field is left untouched.
 */
const migration: Migration = async (directory) => {
  const manifestPath = join(directory, MANIFEST_FILE);
  let raw: Record<string, unknown> = {};
  try {
    const content = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed)) {
      raw = parsed;
    }
  } catch {
    // Missing or unparseable — nothing to strip.
    return;
  }

  const install = raw.install;
  if (isRecord(install) && "installedAt" in install) {
    delete install.installedAt;
    await writeFile(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }
};

export default migration;
