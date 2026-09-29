import { describe, expect, it } from "vitest";

import { CLIError } from "../src/util/cli-error";
import type { ServedFileSet } from "../src/api/v2";
import { writeServedRule } from "../src/rules/files";

/**
 * `index.ts` decides whether to print a failure and set a non-zero exit from
 * `CLIError.reported`. It used to assume every `CLIError` had already reported
 * itself, which made any throw site that had not print nothing and exit 0 —
 * a failure that reads as success.
 */
describe("CLIError reporting contract", () => {
  it("defaults to not-yet-reported", () => {
    expect(new CLIError("boom").reported).toBe(false);
  });

  it("carries the code and the reported flag when given", () => {
    const error = new CLIError("boom", "RULE_UNSUPPORTED", { reported: true });
    expect(error.code).toBe("RULE_UNSUPPORTED");
    expect(error.reported).toBe(true);
  });

  it("throws an unreported error for an engine the CLI does not know", async () => {
    // Nothing prints before this throw, so the top-level handler is the only
    // thing standing between an unsupported engine and a silent exit 0.
    const thrown = await writeServedRule("/nonexistent-project", {
      id: "rule",
      engine: "from-a-newer-cli",
      files: [],
      signatures: [],
    } as unknown as ServedFileSet).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CLIError);
    expect((thrown as CLIError).reported).toBe(false);
    expect((thrown as CLIError).code).toBe("RULE_UNSUPPORTED");
    expect((thrown as CLIError).message).toContain("from-a-newer-cli");
  });
});
