/**
 * The ReportV1 payload, as this CLI builds it.
 *
 * Declared by hand because `z.fromJSONSchema()` validates without inferring a
 * static type. The vendored schema stays the authority: every payload is
 * validated against it before it is sent, and the tests validate payloads
 * built from real rule directories, so a type that drifts from the schema
 * fails there rather than at tskl.es.
 */

export type Tier = "cli" | "cloud" | "legacy";

export type TestStatus = "pass" | "fail" | "refused" | "not-run";

export interface ReportTests {
  status: TestStatus;
  fail: { code: string } | null;
  pass: { code: string } | null;
  withheld: ("fail" | "pass")[];
}

/** `written`: the rule exists and runs. `candidate`: a Cloud rule not yet written. */
export type RuleState = "written" | "candidate";

/** What the rule's pattern cost reviewers over the window, from mined history. */
export interface Surfaced {
  prs: number;
  reviewComments: number;
}

/** What `check` found for one rule, or across all of them, at publish. */
export interface Findings {
  violations: number;
  files: number;
}

export interface ReportRule {
  id: string;
  title: string;
  explain?: string;
  tier: Tier;
  engine?: "sg" | "vale" | "runtime";
  tool?: string;
  language: string;
  state: RuleState;
  /** Present on every written rule exactly when the report carries `findings`. */
  violations?: number;
  files?: number;
  /**
   * A candidate's instances in the code today, as the agent that proposed it
   * estimates them. Required on every candidate and absent on written rules,
   * which carry the measured `violations` instead.
   */
  estimatedViolations?: number;
  surfaced?: Surfaced;
  tests: ReportTests;
}

export interface ReportWindow {
  from: string;
  to: string;
}

export type ReportScope =
  | {
      provider: "github";
      owner: string;
      repo: string;
      url: string;
      retention: "private";
      window: ReportWindow;
    }
  | { provider: "none"; label: string; window: ReportWindow };

export type RedactionKind =
  | "secret"
  | "email"
  | "person"
  | "customer"
  | "host"
  | "ip"
  | "phone"
  | "text";

export interface ReportV1 {
  schemaVersion: "1";
  generatedAt: string;
  producer: { kind: "cli"; cliVersion: string };
  scope: ReportScope;
  history?: {
    mergedPrs: number;
    reviewComments: number;
    agentAssistedPrs: number;
    patterns: { ruleShaped: number; judgment: number };
  };
  /** Present exactly when every written rule carries `violations` and `files`. */
  findings?: Findings;
  rules: ReportRule[];
  redaction: {
    policyVersion: string;
    counts: Record<RedactionKind, number>;
    withheldFixtures: number;
  };
}
