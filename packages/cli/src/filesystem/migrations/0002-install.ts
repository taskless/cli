import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Migration } from "../types";
import { isRecord } from "../../util/is-record";

const MANIFEST_FILE = "taskless.json";

/**
 * Migration 2 — seed an empty `install` object in taskless.json.
 *
 * Idempotent: if `install` already exists as an object, it is preserved.
 * If it is missing or of an unexpected shape, it is replaced with `{}`.
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
    // Missing or unparseable — fall through and write a minimal manifest
  }

  if (!isRecord(raw.install)) {
    raw.install = {};
    await writeFile(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }
};

export default migration;
