import { describe, expect, it } from "vitest";

import {
  BASELINE_VERSION,
  reconciliationStart,
} from "../src/rules/reconcile-marker";
import { getCliVersion } from "../src/wizard/intro";

/**
 * The walk boundary, unit-tested rather than driven through the CLI.
 *
 * Two of these cases depend on which CLI is running (an older build, a
 * nightly against its release), which a spawned process cannot be made to
 * simulate. They are the cases most likely to be "corrected" later, so they
 * are pinned where they can actually be exercised.
 */
describe("reconciliationStart", () => {
  const installed = getCliVersion();

  it("treats a missing marker as the baseline, not as up to date", () => {
    // The whole point of the 0.0.0 baseline: a project that predates the
    // ledger has had NONE of its entries applied. Reading absence as
    // "nothing to do" would silently excuse every existing project from the
    // entries written for it, which is the failure this replaced.
    const noMarker = undefined as string | undefined;
    const walk = reconciliationStart(noMarker);
    expect(walk).toEqual({ from: BASELINE_VERSION, to: installed });
  });

  it("has nothing to walk when the marker is the installed version", () => {
    expect(reconciliationStart(installed)).toBeUndefined();
  });

  it("has nothing to walk when the marker is ahead, which is a downgrade", () => {
    expect(reconciliationStart("999.0.0")).toBeUndefined();
  });

  it("walks forward from an older marker", () => {
    expect(reconciliationStart("0.0.1")).toEqual({
      from: "0.0.1",
      to: installed,
    });
  });

  it("treats a nightly and its release as the same version", () => {
    // Deliberately NOT semver ordering, and this test exists to stop someone
    // "correcting" it into semver. Our nightlies are valid semver
    // (`0.11.0-20260827050231x45e9997`) and the spec ranks a prerelease BELOW
    // its release, so semver would call a project reconciled on the nightly
    // behind the identical release and send it back through an entry it
    // already walked. Same commit, same entries, so only the numeric core is
    // compared.
    expect(
      reconciliationStart(`${installed}-20260827050231x45e9997`)
    ).toBeUndefined();
  });
});
