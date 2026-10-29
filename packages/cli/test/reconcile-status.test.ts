import { describe, expect, it } from "vitest";

import {
  getReconcileNotice,
  type ReconcileStatus,
} from "../src/rules/reconcile-status";

const NOTHING: ReconcileStatus = {
  required: false,
  walk: null,
  engines: [],
  ruleMigrations: [],
};

/**
 * `init` prints this whenever a reconciliation is due, not only on a version
 * move, so the wording has to say which kind is due and whether `check` will
 * refuse in the meantime.
 */
describe("the reconcile notice", () => {
  it("prints nothing when no reconcile is due", () => {
    expect(getReconcileNotice(NOTHING, "taskless")).toBeUndefined();
  });

  it("names an engine move and the refusal it causes", () => {
    const notice = getReconcileNotice(
      {
        ...NOTHING,
        required: true,
        engines: [{ engine: "vale", recorded: "3.20.0", bundled: "3.24.0" }],
        ruleMigrations: [
          { engine: "vale", engineVersion: "3.24.0", summary: "s" },
        ],
      },
      "./.taskless/bin/cli.mjs"
    );
    expect(notice).toContain("Vale moved from 3.20.0 to 3.24.0");
    expect(notice).toContain("will refuse");
    expect(notice).toContain("`./.taskless/bin/cli.mjs update --rules`");
    expect(notice).toContain("1 mechanical rule rewrite(s)");
  });

  it("does not claim a refusal for a walk alone", () => {
    // `check` gates on the engines, not on the ledger.
    const notice = getReconcileNotice(
      { ...NOTHING, required: true, walk: { from: "0.11.0", to: "0.12.0" } },
      "taskless"
    );
    expect(notice).toContain("ledger has entries from 0.11.0 to 0.12.0");
    expect(notice).not.toContain("refuse");
  });
});
