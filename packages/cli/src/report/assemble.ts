import { CLIError } from "../util/cli-error";
import type { ReportDraft } from "./draft";
import type { ReportFacts } from "../schemas/report-facts";
import {
  REDACTION_POLICY_VERSION,
  hasHits,
  scanText,
  type PatternKind,
} from "./redact";
import { REPORT_FIXTURE_MAX_LENGTH } from "./schema";
import type {
  Findings,
  RedactionKind,
  ReportRule,
  ReportScope,
  ReportTests,
  ReportV1,
  TestStatus,
} from "./types";

/**
 * Build the report from the CLI's draft and the agent's facts.
 *
 * The CLI's values win every conflict: the facts carry only what the agent
 * alone knows, and a fact about something the CLI measured (an engine, a test
 * status) never reaches the payload. The monthly rates are not computed at
 * all: tskl.es derives them from each rule's `surfaced` and the window.
 */

/** How many Taskless rules a report needs before it is worth publishing. */
export const MINIMUM_TASKLESS_RULES = 3;

/** A Taskless rule counts toward the gate unless its tests say it is broken. */
const DISQUALIFYING_STATUSES: ReadonlySet<TestStatus> = new Set([
  "fail",
  "refused",
]);

const ZERO_COUNTS: Record<RedactionKind, number> = {
  secret: 0,
  email: 0,
  person: 0,
  customer: 0,
  host: 0,
  ip: 0,
  phone: 0,
  text: 0,
};

interface Candidate {
  rule: Omit<ReportRule, "tests">;
  status: TestStatus;
  fail: string | null;
  pass: string | null;
}

function invalid(message: string): CLIError {
  return new CLIError(message, "REPORT_INVALID");
}

/**
 * The draft's measured counts, when they still cover every written rule.
 *
 * The draft decided what it could measure among the rules it can see. A
 * legacy rule is the one written rule it cannot see: it lives in another
 * linter the CLI does not run, so its arrival in the facts withdraws every
 * count rather than leaving a total that silently skips it.
 */
function measuredFindings(
  draft: ReportDraft,
  facts: ReportFacts
): Findings | undefined {
  if (draft.findings === undefined || facts.legacy.length > 0) return undefined;
  return draft.findings;
}

/** Pair each draft rule with its facts, and add the legacy and cloud rules. */
function mergeRules(
  draft: ReportDraft,
  facts: ReportFacts,
  measured: boolean
): Candidate[] {
  const factsById = new Map(facts.rules.map((rule) => [rule.id, rule]));
  const localIds = new Set(draft.rules.map((rule) => rule.id));

  const unknown = facts.rules
    .map((rule) => rule.id)
    .filter((id) => !localIds.has(id));
  if (unknown.length > 0) {
    throw invalid(
      `facts name rules that are not under .taskless/rules/: ${unknown.join(", ")}. List a rule written into another linter under "legacy", and a candidate you did not write under "cloud".`
    );
  }
  const uncovered = draft.rules
    .map((rule) => rule.id)
    .filter((id) => !factsById.has(id));
  if (uncovered.length > 0) {
    throw invalid(
      `facts are missing for these rules: ${uncovered.join(", ")}. Every rule \`taskless report\` lists needs a "rules" entry with its title and surfaced counts.`
    );
  }

  const candidates: Candidate[] = draft.rules.map((local) => {
    // Checked above: every draft rule has facts.
    const ruleFacts = factsById.get(local.id)!;
    return {
      rule: {
        id: local.id,
        title: ruleFacts.title,
        tier: local.tier,
        engine: local.engine,
        language: local.language,
        state: "written",
        ...(measured && local.violations !== undefined
          ? { violations: local.violations, files: local.files ?? 0 }
          : {}),
        surfaced: ruleFacts.surfaced,
        complexity: null,
      },
      status: local.tests.status,
      fail: local.tests.fail,
      pass: local.tests.pass,
    };
  });

  for (const legacy of facts.legacy) {
    candidates.push({
      rule: {
        id: legacy.id,
        title: legacy.title,
        tier: "legacy",
        tool: legacy.tool,
        language: legacy.language,
        state: "written",
        surfaced: legacy.surfaced,
        complexity: null,
      },
      // The CLI cannot run another linter's rule, so it does not claim it
      // passed. Agent-written legacy rules still count toward the gate.
      status: "not-run",
      fail: legacy.fail ?? null,
      pass: legacy.pass ?? null,
    });
  }

  for (const cloud of facts.cloud) {
    candidates.push({
      rule: {
        id: cloud.id,
        title: cloud.title,
        tier: "cloud",
        engine: "runtime",
        language: cloud.language,
        // Never counted: a candidate is a rule Cloud could write, not one
        // that runs.
        state: "candidate",
        surfaced: cloud.surfaced,
        complexity: cloud.complexity,
      },
      status: "not-run",
      fail: cloud.fail ?? null,
      pass: cloud.pass ?? null,
    });
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { rule } of candidates) {
    if (seen.has(rule.id)) duplicates.add(rule.id);
    seen.add(rule.id);
  }
  if (duplicates.size > 0) {
    throw invalid(
      `rule ids must be unique across the report: ${[...duplicates].join(", ")}`
    );
  }
  return candidates;
}

/** Refuse a report with fewer than three working Taskless rules. */
function enforceGate(candidates: Candidate[]): void {
  const counted = candidates.filter(
    ({ rule, status }) =>
      (rule.tier === "cli" || rule.tier === "legacy") &&
      !DISQUALIFYING_STATUSES.has(status)
  ).length;
  if (counted < MINIMUM_TASKLESS_RULES) {
    throw new CLIError(
      `A report needs at least ${String(MINIMUM_TASKLESS_RULES)} working Taskless rules, and this repository has ${String(counted)} of ${String(MINIMUM_TASKLESS_RULES)}. Rules under .taskless/rules/ whose tests fail do not count, and cloud candidates are carried in addition rather than counted.`,
      "REPORT_INSUFFICIENT"
    );
  }
}

/**
 * Refuse any agent-written string a pattern matches. The CLI cannot rewrite
 * prose, and the agent can, so it is told which field to fix.
 */
function screenStrings(facts: ReportFacts, label: string | undefined): void {
  const fields: [string, string][] = [];
  if (label !== undefined) fields.push(["label", label]);
  // Every agent-supplied string mergeRules copies onto a published rule. Ids
  // count: the schema allows dots, so an id can be a host name.
  for (const group of ["rules", "legacy", "cloud"] as const) {
    for (const rule of facts[group]) {
      fields.push(
        [`${group}[${rule.id}].id`, rule.id],
        [`${group}[${rule.id}].title`, rule.title]
      );
    }
  }
  for (const rule of facts.legacy) {
    fields.push(
      [`legacy[${rule.id}].tool`, rule.tool],
      [`legacy[${rule.id}].language`, rule.language]
    );
  }
  for (const rule of facts.cloud) {
    fields.push([`cloud[${rule.id}].language`, rule.language]);
  }
  const flagged = fields
    .filter(([, text]) => hasHits(scanText(text)))
    .map(([field]) => field);
  if (flagged.length > 0) {
    throw new CLIError(
      `These fields hold something that looks like a secret, an email address, a host, an IP address, or a phone number, and tskl.es does not redact: ${flagged.join(", ")}. Rewrite them without it.`,
      "REPORT_REDACTION"
    );
  }
}

interface RedactionTally {
  counts: Record<RedactionKind, number>;
  withheldFixtures: number;
}

/** Decide each fixture: publish it, or withhold it whole. */
function redactFixtures(
  candidates: Candidate[],
  facts: ReportFacts,
  tally: RedactionTally
): ReportRule[] {
  const agentWithheld = new Set(
    facts.redaction.withheld.map(({ id, side }) => `${id}:${side}`)
  );

  return candidates.map(({ rule, status, fail, pass }) => {
    const tests: ReportTests = { status, fail: null, pass: null, withheld: [] };
    for (const [side, code] of [
      ["fail", fail],
      ["pass", pass],
    ] as const) {
      if (code === null) continue;
      const hits = scanText(code);
      for (const [kind, n] of Object.entries(hits) as [PatternKind, number][]) {
        tally.counts[kind] += n;
      }
      const withhold =
        agentWithheld.has(`${rule.id}:${side}`) ||
        hasHits(hits) ||
        code.length > REPORT_FIXTURE_MAX_LENGTH;
      if (withhold) {
        tests.withheld.push(side);
        tally.withheldFixtures += 1;
      } else {
        tests[side] = { code };
      }
    }
    return { ...rule, tests };
  });
}

/**
 * Refuse a window that ends before it starts. tskl.es divides by its length to
 * derive the monthly rates, so a reversed one is caught here, by field name,
 * rather than as a service validation error.
 */
function checkWindow(window: ReportFacts["window"]): void {
  if (Date.parse(window.to) < Date.parse(window.from)) {
    throw invalid(
      `window.to (${window.to}) is before window.from (${window.from})`
    );
  }
}

function buildScope(draft: ReportDraft, facts: ReportFacts): ReportScope {
  const window = { from: facts.window.from, to: facts.window.to };
  const { scope } = draft;
  if (
    scope.provider === "github" &&
    scope.owner !== undefined &&
    scope.repo !== undefined &&
    scope.url !== undefined
  ) {
    return {
      provider: "github",
      owner: scope.owner,
      repo: scope.repo,
      url: scope.url,
      // Always unlisted. Public retention is a separate decision with its own
      // consent, and this command does not offer it.
      retention: "private",
      window,
    };
  }
  return {
    provider: "none",
    label: facts.label ?? scope.label ?? "Repository",
    window,
  };
}

export function assembleReport(
  draft: ReportDraft,
  facts: ReportFacts,
  now: Date = new Date()
): ReportV1 {
  const findings = measuredFindings(draft, facts);
  const candidates = mergeRules(draft, facts, findings !== undefined);
  enforceGate(candidates);

  const scope = buildScope(draft, facts);
  screenStrings(facts, scope.provider === "none" ? scope.label : undefined);

  const tally: RedactionTally = {
    counts: { ...ZERO_COUNTS },
    withheldFixtures: 0,
  };
  for (const [kind, n] of Object.entries(facts.redaction.counts)) {
    tally.counts[kind as RedactionKind] += n;
  }
  const rules = redactFixtures(candidates, facts, tally);

  checkWindow(facts.window);
  return {
    schemaVersion: "1",
    // Seconds precision: the schema's date-time pattern allows fractions, but a
    // report has no use for them.
    generatedAt: `${now.toISOString().slice(0, 19)}Z`,
    producer: draft.producer,
    scope,
    history: facts.history,
    ...(findings === undefined ? {} : { findings }),
    rules,
    projection: {
      inputs: {
        contextTokens: facts.estimates.contextTokens,
        callsPerCatch: facts.estimates.callsPerCatch,
        ...draft.inputs,
      },
    },
    redaction: {
      policyVersion: REDACTION_POLICY_VERSION,
      counts: tally.counts,
      withheldFixtures: tally.withheldFixtures,
    },
  };
}
