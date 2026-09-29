import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { listRuleIds, ruleDirectory } from "./engines";
import { ENGINES, RULE_TESTS_DIRECTORY, type EngineName } from "./layout";
import { signRuleFile } from "./rule-hash";
import type { Snapshot } from "./snapshot";

/**
 * What `check` tells reconcile it holds: one entry per rule directory, of every
 * engine, each file signed from the snapshot.
 *
 * `ruleId` is the directory name, which is what v2 addresses a rule by. The
 * engine is NOT sent (the service keys on the id alone, and issued ids are
 * unique across engines), but it is kept here, because it is what the verdict
 * policy branches on and the reporting directory is the one fact the CLI has
 * about a rule the service has never heard of.
 */

/** One signed file of a reported rule. */
export interface ReportedFile {
  /** Relative to the rule directory, `/`-separated on every platform. */
  path: string;
  signature: string;
}

/** One reported rule. */
export interface ReportedRule {
  ruleId: string;
  engine: EngineName;
  files: ReportedFile[];
}

/** Two or more rule directories sharing one id under different engines. */
export interface DuplicateRuleId {
  ruleId: string;
  engines: EngineName[];
}

/** A rule whose directory could not be read or signed. */
export interface UnreadableRule {
  ruleId: string;
  engine: EngineName;
  reason: string;
}

export interface RuleReport {
  rules: ReportedRule[];
  duplicates: DuplicateRuleId[];
  unreadable: UnreadableRule[];
}

/**
 * Discover and sign every rule in the snapshot.
 *
 * A duplicate id is reported instead of either rule: reconcile carries no
 * engine, so the two cannot be judged apart, and the caller refuses the run.
 * Skipping the pair instead would let anyone neutralize an issued rule by
 * creating a same-named directory under another engine.
 */
export async function reportRules(snapshot: Snapshot): Promise<RuleReport> {
  const engineById = new Map<string, EngineName[]>();
  for (const engine of ENGINES) {
    for (const ruleId of await listRuleIds(snapshot.base, engine)) {
      engineById.set(ruleId, [...(engineById.get(ruleId) ?? []), engine]);
    }
  }

  const report: RuleReport = { rules: [], duplicates: [], unreadable: [] };
  for (const [ruleId, engines] of [...engineById].toSorted(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (engines.length > 1) {
      report.duplicates.push({ ruleId, engines });
      continue;
    }
    const engine = engines[0] as EngineName;
    const directory = ruleDirectory(snapshot.base, engine, ruleId);
    try {
      const paths = await listReportedPaths(directory);
      const files = await Promise.all(
        paths.map(async (path) => ({
          path,
          signature: await signRuleFile(join(directory, ...path.split("/"))),
        }))
      );
      report.rules.push({ ruleId, engine, files });
    } catch (error) {
      report.unreadable.push({
        ruleId,
        engine,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/**
 * Every regular file under a rule directory, recursively, except the rule's
 * own `.tests/`, as sorted `/`-separated paths.
 *
 * The snapshot has already dereferenced links and dropped operating-system
 * metadata, so every entry here is a real file an engine could read. Only the
 * TOP-LEVEL `.tests/` is a fixture directory; a nested `captures/.tests/` is
 * reported like any other file, because an engine reads it.
 */
async function listReportedPaths(directory: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(absolute: string, prefix: string): Promise<void> {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (prefix === "" && entry.name === RULE_TESTS_DIRECTORY) continue;
      if (entry.isDirectory()) {
        await walk(join(absolute, entry.name), path);
      } else if (entry.isFile()) {
        paths.push(path);
      }
    }
  }
  await walk(directory, "");
  return paths.toSorted((a, b) => a.localeCompare(b));
}
