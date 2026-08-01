import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import type { CaptureRule, MatchMode } from "../../types/runtime-rule";
import { ENGINE_LAYOUTS } from "../engines";

/**
 * Directory (relative to `.taskless/`) that holds runtime rules — the
 * `runtime` engine's own directory, so this tracks the engine layout rather
 * than repeating it. Migration `0004` moved the tree here from
 * `runtime-rules/` without touching a byte, so signatures are unaffected.
 */
export const RUNTIME_RULES_DIR = ENGINE_LAYOUTS.runtime.rulesDirectory;

/** A parsed capture `*.yml` of a runtime rule, with the fields the harness needs. */
export interface LoadedCaptureRule {
  /** Absolute path to the capture `*.yml`. */
  file: string;
  /** Basename of the capture file. */
  fileName: string;
  /** Baked-in ast-grep rule id (used to attribute scan matches back to `name`). */
  id: string;
  /** Stable, model-assigned name (`metadata.taskless.name`), surfaced as `match.rule`. */
  name: string;
  /** ast-grep `language`. */
  language: string;
  /** Scan mode; `anchor` when omitted. */
  match: MatchMode;
  /** The full parsed capture rule (for running the narrow). */
  rule: CaptureRule;
}

/** A discovered runtime rule directory under `.taskless/runtime/rules/`. */
export interface RuntimeRule {
  /** Rule directory basename (e.g. `no-default-export-abc12345`). */
  name: string;
  /** Absolute path to the rule directory. */
  dir: string;
  /** The rule's parsed capture rules, in filename order. */
  captureRules: LoadedCaptureRule[];
  /** Absolute path to the rule's `check.ts`. */
  checkFile: string;
}

/** Narrow an unknown parsed YAML value to a runtime `CaptureRule`, or return null. */
function asRuntimeCaptureRule(value: unknown): CaptureRule | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<CaptureRule>;
  const taskless = candidate.metadata?.taskless;
  if (!taskless || taskless.kind !== "runtime") return null;
  if (typeof candidate.language !== "string") return null;
  if (typeof taskless.name !== "string") return null;
  return candidate as CaptureRule;
}

/** Load and parse the capture rules of a single runtime-rule directory. */
async function loadCaptureRules(
  directory: string
): Promise<LoadedCaptureRule[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const ymlFiles = entries.filter(
    (f) => f.endsWith(".yml") || f.endsWith(".yaml")
  );
  const loaded: LoadedCaptureRule[] = [];
  for (const fileName of ymlFiles.toSorted()) {
    const file = join(directory, fileName);
    let parsed: unknown;
    try {
      parsed = parse(await readFile(file, "utf8"));
    } catch {
      continue; // not valid YAML — skip
    }
    const rule = asRuntimeCaptureRule(parsed);
    if (!rule || typeof rule.id !== "string") continue;
    loaded.push({
      file,
      fileName,
      id: rule.id,
      name: rule.metadata.taskless.name,
      language: rule.language,
      match: rule.metadata.taskless.match ?? "anchor",
      rule,
    });
  }
  return loaded;
}

/**
 * Enumerate `.taskless/runtime/rules/` under `cwd` and return each rule
 * directory that holds at least one `kind: runtime` capture rule.
 * `.taskless/runtime/rule-tests/` is never enumerated — it holds verification
 * fixtures, not executable rules — and neither is any other engine's
 * directory: a rule under `.taskless/sg/rules/` is static by virtue of where
 * it lives, and is never considered here.
 */
export async function discoverRuntimeRules(
  cwd: string
): Promise<RuntimeRule[]> {
  return discoverRuntimeRulesIn(join(cwd, ".taskless", RUNTIME_RULES_DIR));
}

/**
 * Enumerate runtime rules under an explicit runtime-rules root — used to
 * re-discover rules from the materialized `.taskless/.run/` tree so the executed
 * bytes are the blessed ones.
 */
export async function discoverRuntimeRulesIn(
  root: string
): Promise<RuntimeRule[]> {
  let directoryEntries;
  try {
    directoryEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // no runtime rules directory
  }

  const rules: RuntimeRule[] = [];
  const sorted = directoryEntries.toSorted((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of sorted) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const captureRules = await loadCaptureRules(directory);
    if (captureRules.length === 0) continue; // not a runtime rule

    // The check file is always `check.ts` inside the rule directory (per spec).
    // We deliberately do NOT resolve `metadata.taskless.check` as a path — an
    // arbitrary value (e.g. `../../evil.ts`) must not be able to point execution
    // or signing at a file outside the rule directory.
    rules.push({
      name: entry.name,
      dir: directory,
      captureRules,
      checkFile: join(directory, "check.ts"),
    });
  }
  return rules;
}
