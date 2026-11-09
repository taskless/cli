import { describe, expect, it } from "vitest";

import {
  integrityEntrySchema,
  outputSchema,
  type IntegrityEntry,
} from "../src/schemas/check";

/**
 * #647: each `check --json` integrity entry carries only its own verdict's
 * fields. The schema used to be one flat object with every field optional, so
 * it accepted a `missing` entry with `copyOf` and documented that shape.
 */
describe("check --json integrity entries are discriminated on verdict", () => {
  const copyOf = { ruleId: "foo-1", sourceMissing: true };
  const file = { path: ".vale.ini", expected: "1;h=a", got: "1;h=b" };

  it.each<[string, IntegrityEntry]>([
    [
      "unsafe",
      { ruleId: "a", engine: "vale", verdict: "unsafe", files: [file] },
    ],
    ["missing", { ruleId: "a", verdict: "missing", revisionId: "r1" }],
    ["missing without a revision", { ruleId: "a", verdict: "missing" }],
    ["unknown", { ruleId: "a", engine: "runtime", verdict: "unknown" }],
    [
      "unknown copy",
      { ruleId: "a", verdict: "unknown", files: [file], copyOf },
    ],
    ["unaccounted", { ruleId: "a", engine: "sg", verdict: "unaccounted" }],
    ["duplicate", { ruleId: "a", verdict: "duplicate" }],
  ])("accepts a %s entry", (_label, entry) => {
    expect(integrityEntrySchema.parse(entry)).toEqual(entry);
  });

  it.each([
    ["missing with copyOf", { ruleId: "a", verdict: "missing", copyOf }],
    [
      "unsafe with revisionId",
      { ruleId: "a", verdict: "unsafe", files: [], revisionId: "r1" },
    ],
    [
      "unaccounted with files",
      { ruleId: "a", verdict: "unaccounted", files: [file] },
    ],
    ["duplicate with copyOf", { ruleId: "a", verdict: "duplicate", copyOf }],
    ["unsafe without files", { ruleId: "a", verdict: "unsafe" }],
    ["an unknown verdict", { ruleId: "a", verdict: "drifted" }],
  ])("rejects %s", (_label, entry) => {
    expect(integrityEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rejects a mixed entry inside the whole check output", () => {
    const output = {
      success: false,
      results: [],
      integrity: [{ ruleId: "a", verdict: "missing", copyOf }],
    };
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it("does not let the producer's type build a mixed entry", () => {
    // @ts-expect-error: a missing entry has no copyOf.
    const mixed: IntegrityEntry = { ruleId: "a", verdict: "missing", copyOf };
    expect(mixed.verdict).toBe("missing");
  });
});
