/**
 * Where a rule came from, and how often each source called for it.
 *
 * ReportV1 names seven kinds of source and counts explicit call-outs for six
 * of them (`reviews` is counted by `surfaced.reviewComments`). The kinds are
 * the vendored schema's; what this file adds is what the schema cannot say:
 * the group a reader sees each kind under, which kinds must carry a count, and
 * the checks tskl.es applies across `sources`, `evidence` and `surfaced`,
 * repeated here so the agent hears which fact to fix rather than a service
 * error after publish.
 *
 * A test holds the kinds below equal to the vendored schema's, so a schema
 * refresh that adds a kind fails there until it is given a group.
 */

/** `conventions`: what the repository writes down. `reviews`: where someone pointed it out. */
export type SourceGroup = "conventions" | "reviews";

export const SOURCE_GROUPS = {
  "agent-files": "conventions",
  conventions: "conventions",
  docs: "conventions",
  tests: "conventions",
  reviews: "reviews",
  commits: "reviews",
  issues: "reviews",
} as const satisfies Record<string, SourceGroup>;

export type RuleSource = keyof typeof SOURCE_GROUPS;

/** Every kind, in the schema's order. */
export const RULE_SOURCES = [
  "agent-files",
  "conventions",
  "reviews",
  "commits",
  "issues",
  "docs",
  "tests",
] as const satisfies readonly RuleSource[];

/** The kinds `evidence` counts: every kind but `reviews`. */
export type EvidenceSource = Exclude<RuleSource, "reviews">;

export const EVIDENCE_SOURCES = RULE_SOURCES.filter(
  (source): source is EvidenceSource => source !== "reviews"
);

/**
 * Kinds that exist only to be counted. `agent-files` and `conventions` are
 * exempt, since reports from before `evidence` list them without counts.
 */
const COUNTED_SOURCES: readonly EvidenceSource[] = [
  "commits",
  "issues",
  "docs",
  "tests",
];

export type Evidence = Partial<Record<EvidenceSource, number>>;

interface RuleEvidence {
  id: string;
  sources?: RuleSource[];
  evidence?: Evidence;
  surfaced?: { reviewComments: number };
}

/**
 * Every way a set of rules breaks tskl.es's rules for `sources` and
 * `evidence`, one message per failure, naming the rule and the field.
 */
export function evidenceIssues(rules: readonly RuleEvidence[]): string[] {
  const issues: string[] = [];

  const withSources = rules.filter((rule) => rule.sources !== undefined);
  if (withSources.length > 0 && withSources.length < rules.length) {
    const without = rules
      .filter((rule) => rule.sources === undefined)
      .map((rule) => rule.id);
    issues.push(
      `sources must be given on every rule or on none; these rules have none: ${without.join(", ")}`
    );
  }

  for (const { id, sources, evidence, surfaced } of rules) {
    if (sources === undefined) {
      if (evidence !== undefined) {
        issues.push(`${id}: evidence requires sources`);
      }
      continue;
    }
    const duplicated = sources.filter(
      (source, index) => sources.indexOf(source) !== index
    );
    if (duplicated.length > 0) {
      issues.push(`${id}.sources lists ${duplicated.join(", ")} twice`);
    }
    if (sources.includes("reviews") && !surfaced?.reviewComments) {
      issues.push(
        `${id}.sources lists reviews, so surfaced.reviewComments must be at least 1`
      );
    }
    for (const source of COUNTED_SOURCES) {
      if (sources.includes(source) && evidence?.[source] === undefined) {
        issues.push(
          `${id}.sources lists ${source}, so it needs evidence.${source}`
        );
      }
    }
    for (const source of EVIDENCE_SOURCES) {
      if (evidence?.[source] !== undefined && !sources.includes(source)) {
        issues.push(`${id}.evidence.${source} needs sources to list ${source}`);
      }
    }
  }
  return issues;
}

/** A rule's two totals, as the report page shows them. */
export function groupTotals(rule: {
  surfaced?: { reviewComments: number };
  evidence?: Evidence;
}): Record<SourceGroup, number> {
  const totals: Record<SourceGroup, number> = {
    reviews: rule.surfaced?.reviewComments ?? 0,
    conventions: 0,
  };
  for (const source of EVIDENCE_SOURCES) {
    totals[SOURCE_GROUPS[source]] += rule.evidence?.[source] ?? 0;
  }
  return totals;
}
