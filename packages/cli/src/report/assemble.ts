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
  PerTier,
  RedactionKind,
  ReportRule,
  ReportScope,
  ReportTests,
  ReportV1,
  TestStatus,
  Tier,
} from "./types";

/**
 * Build the report from the CLI's draft and the agent's facts.
 *
 * The CLI's values win every conflict: the facts carry only what the agent
 * alone knows, and a fact about something the CLI measured (an engine, a test
 * status) never reaches the payload. The projection is computed here and
 * nowhere else.
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

/** Pair each draft rule with its facts, and add the legacy and cloud rules. */
function mergeRules(draft: ReportDraft, facts: ReportFacts): Candidate[] {
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
      `facts are missing for these rules: ${uncovered.join(", ")}. Every rule \`taskless report\` lists needs a "rules" entry with its title, origin, and fix count.`
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
        origin: ruleFacts.origin,
        fixed: ruleFacts.fixed,
        fixedBasis: ruleFacts.fixedBasis,
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
        origin: legacy.origin,
        fixed: legacy.fixed,
        fixedBasis: legacy.fixedBasis,
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
        origin: cloud.origin,
        fixed: cloud.fixed,
        fixedBasis: cloud.fixedBasis,
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
  for (const group of ["rules", "legacy", "cloud"] as const) {
    for (const rule of facts[group]) {
      fields.push([`${group}[${rule.id}].title`, rule.title]);
    }
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

/** Days in an inclusive window, at least one. */
function windowDays(window: ReportFacts["window"]): number {
  const from = Date.parse(`${window.from}T00:00:00Z`);
  const to = Date.parse(`${window.to}T00:00:00Z`);
  if (to < from) {
    throw invalid(
      `window.to (${window.to}) is before window.from (${window.from})`
    );
  }
  return Math.round((to - from) / 86_400_000) + 1;
}

/** Sum a per-rule figure by tier, normalized to a 30-day month. */
function perMonth(
  rules: ReportRule[],
  days: number,
  pick: (rule: ReportRule) => number
): PerTier {
  const totals: Record<Tier, number> = { cli: 0, cloud: 0, legacy: 0 };
  for (const rule of rules) totals[rule.tier] += pick(rule);
  const scale = (n: number) => Math.round((n * 30) / days);
  return {
    cli: scale(totals.cli),
    cloud: scale(totals.cloud),
    ...(totals.legacy > 0 ? { legacy: scale(totals.legacy) } : {}),
  };
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
  const candidates = mergeRules(draft, facts);
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

  const days = windowDays(facts.window);
  return {
    schemaVersion: "1",
    // Seconds precision: the schema's date-time pattern allows fractions, but a
    // report has no use for them.
    generatedAt: `${now.toISOString().slice(0, 19)}Z`,
    producer: draft.producer,
    scope,
    history: facts.history,
    rules,
    projection: {
      perMonth: {
        commentsPrevented: perMonth(
          rules,
          days,
          (rule) => rule.origin?.reviewComments ?? 0
        ),
        agentCatches: perMonth(rules, days, (rule) => rule.fixed),
      },
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
