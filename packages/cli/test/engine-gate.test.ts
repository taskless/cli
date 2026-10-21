import { describe, expect, it } from "vitest";

import {
  engineMismatchMessage,
  findEngineMismatches,
} from "../src/rules/engine-gate";

const BUNDLED = { sg: "0.51.0", vale: "3.24.0" };
const BOTH = new Set(["sg", "vale"] as const);

/**
 * `rules.engines` records what the rules were last reconciled for. `check`
 * and `verify` refuse when it differs from what this CLI bundles, for an
 * engine that has rules to run.
 */
describe("finding engine mismatches", () => {
  it("passes rules reconciled for the bundled engines", () => {
    expect(findEngineMismatches(BUNDLED, BOTH, BUNDLED)).toEqual([]);
  });

  it("reports an engine behind the bundled one", () => {
    expect(
      findEngineMismatches({ sg: "0.45.3", vale: "3.24.0" }, BOTH, BUNDLED)
    ).toEqual([{ engine: "sg", recorded: "0.45.3", bundled: "0.51.0" }]);
  });

  it("reports an engine ahead of the bundled one", () => {
    expect(
      findEngineMismatches({ sg: "0.51.0", vale: "3.25.0" }, BOTH, BUNDLED)
    ).toEqual([{ engine: "vale", recorded: "3.25.0", bundled: "3.24.0" }]);
  });

  it("ignores an engine the project has no rules for", () => {
    expect(
      findEngineMismatches(
        { sg: "0.51.0", vale: "3.18.0" },
        new Set(["sg"] as const),
        BUNDLED
      )
    ).toEqual([]);
  });

  it("ignores an engine that was never recorded", () => {
    expect(findEngineMismatches({ sg: "0.51.0" }, BOTH, BUNDLED)).toEqual([]);
    expect(findEngineMismatches(undefined, BOTH, BUNDLED)).toEqual([]);
    expect(findEngineMismatches({ sg: 51 }, BOTH, BUNDLED)).toEqual([]);
  });
});

describe("the engine mismatch message", () => {
  it("sends rules that are behind through update --rules", () => {
    const message = engineMismatchMessage(
      [{ engine: "sg", recorded: "0.45.3", bundled: "0.51.0" }],
      "npx x"
    );
    expect(message).toContain("ast-grep 0.45.3 (this CLI bundles 0.51.0)");
    expect(message).toContain("`npx x update`");
    expect(message).toContain("`npx x update --rules`");
  });

  it("sends rules that are ahead to the recorded CLI", () => {
    const message = engineMismatchMessage(
      [{ engine: "vale", recorded: "3.25.0", bundled: "3.24.0" }],
      "npx x"
    );
    expect(message).toContain("Vale 3.25.0");
    expect(message).toContain("newer CLI");
    expect(message).not.toContain("update --rules");
  });
});
