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

export interface ReportRule {
  id: string;
  title: string;
  tier: Tier;
  engine?: "sg" | "vale" | "runtime";
  tool?: string;
  language: string;
  origin?: { reviewComments: number; prs: number };
  fixed: number;
  fixedBasis: "measured" | "estimated";
  complexity: number | null;
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

export interface PerTier {
  cli: number;
  cloud: number;
  legacy?: number;
}

export interface ProjectionInputs {
  contextTokens: number;
  callsPerCatch: number;
  cloudComplexity: number;
  pricePerMillionTokens: number;
  minutesPerComment: number;
  reviewerHourlyUsd: number;
}

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
  rules: ReportRule[];
  projection: {
    perMonth: { commentsPrevented: PerTier; agentCatches: PerTier };
    inputs: ProjectionInputs;
  };
  redaction: {
    policyVersion: string;
    counts: Record<RedactionKind, number>;
    withheldFixtures: number;
  };
}
