import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { parseDocument } from "yaml";

import {
  listRuleIds,
  ruleFilePath,
  ruleTestsDirectory,
} from "../rules/engines";
import { isMissingDirectory } from "../rules/errno";
import { verifyOneRule } from "../rules/inspect";
import { scanProject } from "../rules/scan-project";
import { resolveRepositoryContext } from "../util/git-remote";
import { CLI_VERSION } from "../version";
import { countFindings, type Measurement } from "./findings";
import type { Findings, ProjectionInputs, TestStatus } from "./types";

/**
 * Everything about a report the CLI can establish on its own, without the
 * network and without the agent.
 *
 * `taskless report` prints this, and `taskless report --from` builds on it, so
 * the two can never disagree about what a rule's engine, language or test
 * status is: the CLI's answer is the one published, whatever the facts say.
 */

/** A rule under `.taskless/rules/`, as the CLI sees it. */
export interface LocalRule {
  id: string;
  engine: "sg" | "vale" | "runtime";
  tier: "cli" | "cloud";
  language: string;
  tests: {
    status: TestStatus;
    /** First fixture the rule flags, or null when it has none. */
    fail: string | null;
    /** First fixture the rule accepts, or null when it has none. */
    pass: string | null;
  };
  /** Matches in the code today, from the CLI's own scan; absent when unmeasured. */
  violations?: number;
  /** Files holding those matches. */
  files?: number;
}

export interface DraftScope {
  provider: "github" | "none";
  owner?: string;
  repo?: string;
  url?: string;
  /** For `provider: "none"`: the default label, the directory name. */
  label?: string;
}

export interface ReportDraft {
  producer: { kind: "cli"; cliVersion: string };
  scope: DraftScope;
  rules: LocalRule[];
  inputs: Omit<ProjectionInputs, "contextTokens" | "callsPerCatch">;
  /**
   * What the rules find in the code today, across every rule, from the CLI's
   * own scan. Absent when any rule could not be measured; `unmeasured` says why.
   */
  findings?: Findings;
  unmeasured?: string;
  /** The facts the agent must still supply, by facts-file key. */
  missing: string[];
}

/**
 * The projection inputs the agent does not estimate.
 *
 * The values tskl.es's own example uses. The page exposes every input as a
 * slider, so these are starting points a reader adjusts, not claims.
 */
export const DEFAULT_PROJECTION_INPUTS: ReportDraft["inputs"] = {
  cloudComplexity: 3,
  pricePerMillionTokens: 0.5,
  minutesPerComment: 15,
  reviewerHourlyUsd: 110,
};

/**
 * What a Vale rule's language is reported as. Vale lints prose, not a
 * programming language, and the schema requires a language for every rule.
 */
const VALE_LANGUAGE = "Prose";

/** What a runtime rule's checks are written in. */
const RUNTIME_LANGUAGE = "TypeScript";

async function readFirstFile(directory: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return null;
    throw error;
  }
  const first = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b))[0];
  if (first === undefined) return null;
  const raw = await readFile(join(directory, first), "utf8");
  const content = raw.trim();
  return content === "" ? null : content;
}

/** The first `invalid:` and `valid:` case across an sg rule's test files. */
async function sgFixtures(
  cwd: string,
  id: string
): Promise<{ fail: string | null; pass: string | null }> {
  const directory = ruleTestsDirectory(cwd, "sg", id);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isMissingDirectory(error)) return { fail: null, pass: null };
    throw error;
  }
  const names = entries
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted((a, b) => a.localeCompare(b));
  let fail: string | null = null;
  let pass: string | null = null;
  for (const name of names) {
    const source = await readFile(join(directory, name), "utf8");
    const parsed: unknown = parseDocument(source).toJS();
    if (typeof parsed !== "object" || parsed === null) continue;
    const document = parsed as { valid?: unknown; invalid?: unknown };
    fail ??= firstString(document.invalid);
    pass ??= firstString(document.valid);
  }
  return { fail, pass };
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first: unknown = value.find(
    (item) => typeof item === "string" && item.trim() !== ""
  );
  return typeof first === "string" ? first.trim() : null;
}

/** An sg rule's `language:`, as ast-grep spells it. */
async function sgLanguage(cwd: string, id: string): Promise<string> {
  try {
    const source = await readFile(ruleFilePath(cwd, "sg", id), "utf8");
    const parsed: unknown = parseDocument(source).toJS();
    const language = (parsed as { language?: unknown } | null)?.language;
    if (typeof language === "string" && language !== "") return language;
  } catch {
    // An unreadable rule is `validate`'s finding to report. Here it only
    // costs the language, which falls back below.
  }
  return "Unknown";
}

async function testStatus(
  cwd: string,
  engine: "sg" | "vale",
  id: string
): Promise<TestStatus> {
  const verification = await verifyOneRule(cwd, { engine, ruleId: id });
  if (verification.refused !== undefined) return "refused";
  return verification.ok && verification.ran ? "pass" : "fail";
}

/** Every rule under `.taskless/rules/`, with its tests run. */
export async function collectLocalRules(cwd: string): Promise<LocalRule[]> {
  const rules: LocalRule[] = [];
  for (const id of await listRuleIds(cwd, "sg")) {
    rules.push({
      id,
      engine: "sg",
      tier: "cli",
      language: await sgLanguage(cwd, id),
      tests: {
        status: await testStatus(cwd, "sg", id),
        ...(await sgFixtures(cwd, id)),
      },
    });
  }
  for (const id of await listRuleIds(cwd, "vale")) {
    const tests = ruleTestsDirectory(cwd, "vale", id);
    rules.push({
      id,
      engine: "vale",
      tier: "cli",
      language: VALE_LANGUAGE,
      tests: {
        status: await testStatus(cwd, "vale", id),
        fail: await readFirstFile(join(tests, "fail")),
        pass: await readFirstFile(join(tests, "pass")),
      },
    });
  }
  // A runtime rule runs only where Taskless Cloud blessed it, and a report is
  // published logged out, so it is reported as the cloud tier, untested.
  for (const id of await listRuleIds(cwd, "runtime")) {
    rules.push({
      id,
      engine: "runtime",
      tier: "cloud",
      language: RUNTIME_LANGUAGE,
      tests: { status: "not-run", fail: null, pass: null },
    });
  }
  return rules;
}

export async function resolveDraftScope(cwd: string): Promise<DraftScope> {
  const { repositoryUrl } = await resolveRepositoryContext(cwd);
  if (repositoryUrl !== null) {
    // `resolveRepositoryContext` returns the canonical
    // `https://github.com/{owner}/{repo}`, so both are positional.
    const segments = repositoryUrl.split("/");
    const owner = segments[3];
    const repo = segments[4];
    if (owner !== undefined && repo !== undefined) {
      return { provider: "github", owner, repo, url: repositoryUrl };
    }
  }
  return { provider: "none", label: basename(cwd) };
}

/** The facts-file keys the agent must supply for this draft. */
function missingFacts(rules: LocalRule[]): string[] {
  return [
    "window",
    "history",
    "estimates",
    ...rules.map((rule) => `rules[${rule.id}]`),
  ];
}

/**
 * Scan the project as `check --anonymous` would and count each rule's matches.
 *
 * Anonymous keeps the draft offline: no reconcile, so no request. A scan that
 * throws leaves the report unmeasured rather than failing the draft, since
 * every other fact in it is still worth printing.
 */
async function measureLocalRules(
  cwd: string,
  rules: LocalRule[]
): Promise<Measurement> {
  const counted = rules.map(({ id, engine }) => ({ id, engine }));
  // Nothing to scan, or a rule no anonymous scan runs: the count is decided
  // without spending a scan on it.
  if (rules.length === 0 || rules.some((rule) => rule.engine === "runtime")) {
    return countFindings({ cwd, rules: counted, failures: [], results: [] });
  }
  try {
    const { plan, dispatched } = await scanProject(cwd, {
      paths: [],
      anonymous: true,
      dangerouslyRunScripts: false,
    });
    return countFindings({
      cwd,
      rules: counted,
      failures: [...plan.failures, ...dispatched.failures],
      results: dispatched.results,
    });
  } catch (error) {
    return {
      measured: false,
      reason: `the scan failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function buildDraft(cwd: string): Promise<ReportDraft> {
  const [scope, collected] = await Promise.all([
    resolveDraftScope(cwd),
    collectLocalRules(cwd),
  ]);
  const measurement = await measureLocalRules(cwd, collected);
  const rules = measurement.measured
    ? collected.map((rule) => ({
        ...rule,
        ...measurement.perRule.get(rule.id),
      }))
    : collected;
  return {
    producer: { kind: "cli", cliVersion: CLI_VERSION },
    scope,
    rules,
    inputs: DEFAULT_PROJECTION_INPUTS,
    ...(measurement.measured
      ? { findings: measurement.findings }
      : { unmeasured: measurement.reason }),
    missing: missingFacts(rules),
  };
}
