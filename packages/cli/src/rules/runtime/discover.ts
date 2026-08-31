import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import {
  MATCH_MODES,
  SUPPORTED_METADATA_VERSIONS,
} from "../../types/runtime-rule";
import type { CaptureRule, MatchMode } from "../../types/runtime-rule";
import { RULES_DIRECTORY } from "../layout";

/**
 * Directory (relative to `.taskless/`) that holds runtime rules — the
 * `runtime` engine's own directory, so this tracks the engine layout rather
 * than repeating it. Migrations `0004` and `0005` moved the tree here without
 * touching a byte, so signatures are unaffected.
 */
export const RUNTIME_RULES_DIR = join(RULES_DIRECTORY, "runtime");

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

/** A discovered runtime rule directory under `.taskless/rules/runtime/`. */
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

/**
 * Narrow an unknown `match` value to a {@link MatchMode}. An absent value is
 * `anchor`, the documented default; an unrecognized one is `undefined`.
 *
 * This deliberately does NOT fall back to `anchor`. The two modes scan
 * different things — `anchor` is a syntactic narrow, `broad` a whole-language
 * enumerator — so coercing an unimplemented third mode to `anchor` does not
 * degrade the rule, it reinterprets it: the capture runs, matches a fraction of
 * what it was written for, and the shortfall is reported as a clean pass.
 */
function asMatchMode(value: unknown): MatchMode | undefined {
  if (value === undefined) return "anchor";
  const modes: readonly string[] = MATCH_MODES;
  return typeof value === "string" && modes.includes(value)
    ? (value as MatchMode)
    : undefined;
}

/**
 * What a parsed capture `*.yml` is: loadable, or refused with a reason.
 *
 * ONE FUNCTION, TWO CALLERS, ON PURPOSE. Discovery uses it to refuse a capture
 * it cannot run; `verify` uses it to tell the author why. Those answers have to
 * agree — a capture silently absent from a run while `verify` calls the rule
 * valid is precisely the confusion this engine's design exists to prevent — and
 * the cheapest way to guarantee they agree is for there to be one answer.
 *
 * The reason is a sentence rather than a code because its only consumer is a
 * person reading `verify` output. Nothing branches on it.
 */
export type CaptureAssessment =
  | { ok: true; rule: CaptureRule; match: MatchMode }
  | { ok: false; reason: string };

export function assessCaptureRule(value: unknown): CaptureAssessment {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "is not a YAML mapping" };
  }
  const candidate = value as Partial<CaptureRule>;
  const taskless = candidate.metadata?.taskless;
  if (!taskless) {
    return {
      ok: false,
      reason:
        "has no metadata.taskless block, so nothing marks it as a runtime capture",
    };
  }
  if (taskless.kind !== "runtime") {
    return {
      ok: false,
      reason: `declares metadata.taskless.kind: ${JSON.stringify(taskless.kind)}, not "runtime"`,
    };
  }
  const versions: readonly unknown[] = SUPPORTED_METADATA_VERSIONS;
  if (!versions.includes(taskless.version)) {
    return {
      ok: false,
      reason:
        `declares metadata.taskless.version ${JSON.stringify(taskless.version)}, ` +
        `which this build does not implement (supported: ${SUPPORTED_METADATA_VERSIONS.join(", ")})`,
    };
  }
  if (typeof candidate.language !== "string") {
    return {
      ok: false,
      reason:
        "has no string `language`, so ast-grep cannot parse anything with it",
    };
  }
  if (typeof taskless.name !== "string") {
    return {
      ok: false,
      reason:
        "has no string metadata.taskless.name, which is what a check branches on",
    };
  }
  if (typeof candidate.id !== "string") {
    return {
      ok: false,
      reason:
        "has no string `id`, so its matches cannot be attributed back to it",
    };
  }
  const match = asMatchMode(taskless.match);
  if (match === undefined) {
    return {
      ok: false,
      reason:
        `declares match: ${JSON.stringify(taskless.match)}, which this build does not ` +
        `implement (valid: ${MATCH_MODES.join(", ")})`,
    };
  }
  return { ok: true, rule: candidate as CaptureRule, match };
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
    // Refused, never coerced or guessed at. `verify` names the file and the
    // reason (see `inspect.ts`, which calls the same assessor), so a capture
    // disappearing from the run is explained rather than left to look like a
    // rule that found nothing.
    const assessment = assessCaptureRule(parsed);
    if (!assessment.ok) continue;
    const { rule, match } = assessment;
    loaded.push({
      file,
      fileName,
      id: rule.id as string,
      name: rule.metadata.taskless.name,
      language: rule.language,
      match,
      rule,
    });
  }
  return loaded;
}

/**
 * Enumerate `.taskless/rules/runtime/` under `cwd` and return each rule
 * directory that holds at least one `kind: runtime` capture rule.
 * `.taskless/rules/runtime/<id>/.tests/` is never enumerated — it holds verification
 * fixtures, not executable rules — and neither is any other engine's
 * directory: a rule under `.taskless/rules/sg/` is static by virtue of where
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
    // Capture rules live in `captures/`, not at the rule root. The name avoids
    // "matcher", which denotes a Vale `[<glob>]` config section elsewhere in
    // this same tree.
    const captureRules = await loadCaptureRules(join(directory, "captures"));
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
