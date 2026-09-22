import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CLIError } from "../util/cli-error";
import { buildInvocation } from "../util/invocation";

/**
 * The `.taskless/taskless.json` manifest: its shape, and reading and writing it.
 *
 * SPLIT OUT OF `migrate.ts` SO THE MANIFEST CAN BE READ WITHOUT LOADING EVERY
 * MIGRATION. The two halves were one module, so "read the manifest" pulled in
 * the migration registry, and a migration importing anything that reads the
 * manifest closed a loop through the runner. That is not hypothetical: `0009`
 * reached `rules/reconcile-marker` for `pathExists`, reconcile-marker reads the
 * manifest, and the cycle left `migrations["9"]` holding `undefined` on any
 * graph entered through `rules/files.ts` — surfacing as
 * `TypeError: migrate is not a function` in the middle of a rule write, and
 * only there, because every other entry point happened to evaluate the modules
 * in a working order.
 *
 * THIS MODULE MUST NOT IMPORT `migrate.ts`. That is the whole property it
 * exists to hold: the manifest is data plus two accessors, and nothing about
 * reading it needs to know that migrations exist.
 */

export interface TasklessInstallTarget {
  skills?: string[];
  commands?: string[];
  /**
   * Install mode for this target: `canonical` (full content) or `reference`
   * (stubs delegating to the canonical store). Absent in manifests written
   * before this field existed; consumers treat a missing value as canonical.
   */
  mode?: "canonical" | "reference";
}

export interface TasklessInstallManifest {
  cliVersion?: string;
  targets?: Record<string, TasklessInstallTarget>;
  onboarded?: boolean;
}

/**
 * What the project's rules were last reconciled against.
 *
 * Separate from `install` on purpose, because the two answer different
 * questions and drift apart. `install` records how the scaffold got here;
 * `rules` records what the rules are valid against. Conflating them is what
 * made `install.cliVersion` a bad candidate for this: a skills refresh moves
 * it without anyone having read a rule.
 *
 * Every field here advances ONLY on a completed reconciliation, never on an
 * upgrade. If a CLI bump silently rewrote `engines.sg` to the newly vendored
 * version, the field would always report "current" and the divergence it
 * exists to expose would be invisible.
 */
export interface TasklessRulesManifest {
  /** CLI version whose ledger entries have all been walked and acted on. */
  reconciledTo?: string;
  /**
   * Engine versions the rules were authored and last reconciled against.
   *
   * Engine version is what determines whether matching semantics moved under
   * a rule, so recording it is what lets a later differential ask a concrete
   * question instead of reconstructing one.
   */
  engines?: {
    sg?: string;
    vale?: string;
  };
}

export interface TasklessManifest {
  version: number;
  install?: TasklessInstallManifest;
  rules?: TasklessRulesManifest;
}

const MANIFEST_FILE = "taskless.json";

/**
 * The refusal a manifest that exists but cannot be read produces.
 *
 * Named separately because the remedy is the interesting part. It must NOT
 * say "run `init`": `init` re-runs every migration and then rewrites the
 * manifest from what it managed to parse, which for an unreadable file is
 * nothing. Measured on a manifest whose first line reads `"version": 6` and
 * whose second is a leftover `<<<<<<< HEAD`: the file came back as
 * `{"version": 6}` with `install.onboarded` and the whole `rules` block gone.
 */
function unreadableManifest(path: string, reason: string): CLIError {
  return new CLIError(
    `${path} could not be read: ${reason}.\n\n` +
      `This is not a schema version mismatch, so migrating will not help: ` +
      `\`${buildInvocation()} init\` refuses here too, rather than rewriting the file ` +
      `with only the part it can parse. A leftover merge conflict, a truncated write ` +
      `or a partial editor save are the usual causes.\n\n` +
      `Repair the JSON by hand, or delete the file to rebuild the scaffold from scratch.`,
    "SCAFFOLD_MANIFEST_UNREADABLE"
  );
}

/**
 * Read the manifest file, returning the full parsed record plus the normalized
 * version. Unknown top-level fields are preserved so callers can round-trip
 * them on write.
 *
 * ABSENT AND UNREADABLE ARE DIFFERENT STATES, and collapsing them was the bug
 * in taskless/cli#278. An absent manifest is an ordinary fresh project and
 * reads as version 0. A manifest that is present and unparseable read as
 * version 0 too, which `requireCurrentSchema` then reported as fact: a file
 * declaring `"version": 6` produced "This project's .taskless/ is at schema
 * version 0". The number was invented, and acting on it destroyed the file.
 *
 * So the second case throws. Every caller that could rewrite the manifest
 * reaches it first, which is what makes the refusal a guard rather than a
 * better message.
 */
export async function readRawManifest(
  directory: string
): Promise<{ version: number; raw: Record<string, unknown> }> {
  const path = join(directory, MANIFEST_FILE);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { version: 0, raw: {} };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw unreadableManifest(
      path,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Any non-object (`null`, an array, a primitive) is valid JSON that is not a
  // manifest. Reading `.version` off `null` would throw a bare TypeError, and
  // treating it as version 0 has the same consequence as an unparseable file:
  // the next write replaces whatever is there.
  if (!isPlainObject(parsed)) {
    throw unreadableManifest(path, "its top-level value is not a JSON object");
  }

  // A missing or non-numeric `version` on an otherwise readable object is NOT
  // this failure. The rest of the object survives a migration untouched, since
  // every write merges over `raw`, so migrating from 0 loses nothing.
  const version = Number(parsed.version);
  return {
    version: Number.isFinite(version) ? version : 0,
    raw: parsed,
  };
}

export async function writeRawManifest(
  directory: string,
  raw: Record<string, unknown>
): Promise<void> {
  await writeFile(
    join(directory, MANIFEST_FILE),
    JSON.stringify(raw, null, 2) + "\n",
    "utf8"
  );
}

/**
 * Read the full manifest, returning the typed shape. Unknown fields are
 * discarded by this API — if you need round-trip preservation, use
 * {@link readManifest} below and pass its `raw` object back through
 * {@link writeManifest}.
 */
export async function readManifest(
  directory: string
): Promise<{ manifest: TasklessManifest; raw: Record<string, unknown> }> {
  const { version, raw } = await readRawManifest(directory);
  const install = raw.install as TasklessInstallManifest | undefined;
  const rules = raw.rules as TasklessRulesManifest | undefined;
  return {
    manifest: {
      version,
      install: isPlainObject(install) ? install : undefined,
      rules: isPlainObject(rules) ? rules : undefined,
    },
    raw,
  };
}

/**
 * Write the manifest, merging the provided fields over any existing unknown
 * top-level fields stored in `raw`. Callers typically pass the `raw` object
 * returned by {@link readManifest} to preserve forward-compatible state.
 */
export async function writeManifest(
  directory: string,
  manifest: TasklessManifest,
  raw: Record<string, unknown> = {}
): Promise<void> {
  const merged: Record<string, unknown> = { ...raw, version: manifest.version };
  if (manifest.install === undefined) {
    delete merged.install;
  } else {
    merged.install = manifest.install;
  }
  if (manifest.rules === undefined) {
    delete merged.rules;
  } else {
    merged.rules = manifest.rules;
  }
  await writeRawManifest(directory, merged);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
