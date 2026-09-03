import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AST_GREP_VERSION, VALE_VERSION } from "../src/rules/capabilities";
import { AST_GREP_BINARY } from "../src/rules/ast-grep-binary";
import { VALE_BINARY } from "../src/rules/vale/binary";
import { resolvePlatformBinary } from "../src/rules/platform-binary";

/**
 * The published engine versions agree with the pins that install them.
 *
 * `@taskless/cli/node/runtimes` publishes `AST_GREP_VERSION` and
 * `VALE_VERSION` so a consumer can know which engine it should have WITHOUT
 * spawning it. That is the whole point of publishing them: the platform
 * generator verifies generated rules in a sandbox, and asking it to shell out
 * to `--version` to find out whether it trusts us is the coordination the
 * export exists to remove.
 *
 * A published number a consumer trusts has to be checked by us, and there are
 * two links in that chain:
 *
 * 1. **Constant matches the pin.** Asserted here, statically, with no binary
 *    involved. This is what catches bumping `optionalDependencies` without
 *    `capabilities.ts` or the reverse, which is the drift a hand-maintained
 *    constant invites.
 * 2. **Constant matches what the binary reports.** Asserted by spawning it, in
 *    `ast-grep-vendor-contract.test.ts` and `vale-schema-contract.test.ts`.
 *
 * Neither link alone is enough. The execution tests would pass while the pin
 * said something else, because they read the binary the pin installed and
 * never look at the pin; this test would pass while the shipped binary
 * disagreed with both. Together they are what makes the published constant a
 * fact rather than a claim.
 *
 * This is deliberately NOT derived from `optionalDependencies` at build time.
 * The generator team asked for that, reasoning that a hand-maintained constant
 * is a second copy of a fact we already hold. The reasoning is right and the
 * remedy is a check rather than a derivation: `capabilities.ts` carries far
 * more than a version — the language lists, the format tiers — measured
 * against the binary rather than read from a manifest, and a version derived
 * from a different source than the table it sits in would be the odd one out.
 */

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")
) as { optionalDependencies: Record<string, string> };

/** Every pin for a platform family, deduplicated. */
function pinnedVersions(prefix: string): string[] {
  const versions = Object.entries(manifest.optionalDependencies)
    .filter(([name]) => name.startsWith(prefix))
    .map(([, version]) => version);
  return [...new Set(versions)];
}

describe("the published engine versions agree with their pins", () => {
  it("ast-grep's constant is the version its platform packages pin", () => {
    const pinned = pinnedVersions("@ast-grep/cli-");
    expect(pinned.length, "platform packages disagree on a version").toBe(1);
    // Upstream's own packages, so the pin is the version verbatim.
    expect(pinned[0]).toBe(AST_GREP_VERSION);
  });

  it("vale's constant is the version its platform packages pin, before our build stamp", () => {
    const pinned = pinnedVersions("@taskless/vale-");
    expect(pinned.length, "platform packages disagree on a version").toBe(1);

    // Ours to repackage, so the pin carries a build stamp the upstream version
    // does not: `3.19.0` is what Vale reports, `3.19.0-<stamp>` is the npm
    // version that ships it. Asserting the RELATIONSHIP rather than equality,
    // because asserting equality would fail on every republish of an unchanged
    // Vale and asserting a prefix alone would accept `3.19.0` matching a pin of
    // `3.19.01`.
    const [pin] = pinned;
    expect(
      pin === VALE_VERSION || pin?.startsWith(`${VALE_VERSION}-`),
      `pin ${String(pin)} is neither ${VALE_VERSION} nor a build stamp of it`
    ).toBe(true);
  });

  it("does not publish the constants from the runtimes entry", async () => {
    // Withdrawn deliberately. `source` answers "is this the pinned engine"
    // directly and at resolution time; a version constant answers it later and
    // worse, by inviting a comparison against a number instead of a check of
    // where the binary came from. Asserted so a well-meaning re-export does not
    // quietly reintroduce the surface we agreed not to carry.
    const entry = (await import("../src/node/runtimes/index")) as Record<
      string,
      unknown
    >;
    expect(entry.AST_GREP_VERSION).toBeUndefined();
    expect(entry.VALE_VERSION).toBeUndefined();
  });
});

describe("a resolution says which tier answered", () => {
  it("reports platform-package when the pinned install provided the binary", () => {
    // The fact the trust chain hangs on. `isPlatformBinary` cannot answer it:
    // it verifies the file exists and identifies as the right tool, which
    // every tier satisfies by the time a path is returned. Identity is not
    // provenance, and a consumer told to gate on it would believe it had
    // checked something it had not.
    const resolution = resolvePlatformBinary(AST_GREP_BINARY);
    expect(resolution.path).toBeDefined();
    expect(resolution.source).toBe("platform-package");
  });

  it("reports no source when nothing resolved", () => {
    const missing = resolvePlatformBinary({
      ...AST_GREP_BINARY,
      packagePrefix: "@taskless/does-not-exist",
      binaryNames: ["taskless-no-such-binary"],
    });
    expect(missing.path).toBeUndefined();
    expect(missing.source).toBeUndefined();
  });

  it("still names the actual package in `tried`, not the tier", () => {
    // The tier and the label are separate on purpose: a failure message saying
    // "platform-package" is less actionable than one naming the package a user
    // can install.
    const { tried } = resolvePlatformBinary(AST_GREP_BINARY);
    expect(tried.some((t) => t.startsWith("@ast-grep/cli-"))).toBe(true);
    expect(tried).not.toContain("platform-package");
  });
});

/**
 * The third link: a pinned package contains the version its NAME claims.
 *
 * The pin says `@ast-grep/cli-…: 0.45.2`, and nothing forced the file inside it
 * to be that. A mispublished or substituted package satisfies the pin, installs
 * cleanly, and answers `--version` with something else.
 *
 * `ast-grep-vendor-contract.test.ts` already spawns an ast-grep and compares it
 * to the constant, but it spawns whatever `findSgBinary` RESOLVED — the pinned
 * package when that tier wins, and a `PATH` binary when it does not. It closes
 * this link by luck of resolution order rather than by asserting it, and it
 * would compare the wrong binary on a host missing the optional dependency.
 *
 * Here the tier is required rather than assumed, which is what `source` is for.
 */
describe("a pinned package contains the version its name claims", () => {
  it.each([
    ["ast-grep", AST_GREP_BINARY, () => `ast-grep ${AST_GREP_VERSION}`],
    ["vale", VALE_BINARY, () => `vale version ${VALE_VERSION}`],
  ])(
    "%s reports the pinned version from inside the package",
    (label, spec, expected) => {
      const { path, source } = resolvePlatformBinary(spec);
      if (path === undefined) {
        // The optional dependency for this platform is not installed. Nothing to
        // assert about a package that is not here.
        return;
      }

      // A resolution from another tier means the pinned package is absent while
      // some other copy is present, which is the state that makes the existing
      // vendor-contract test compare the wrong binary. Fail rather than skip: a
      // silent pass here would be this file's own failure mode.
      expect(
        source,
        `${label} resolved from ${String(source)}, so this asserts nothing about the pinned package`
      ).toBe("platform-package");

      const result = spawnSync(path, ["--version"], { encoding: "utf8" });
      expect(result.stdout.trim()).toBe(expected());
    }
  );
});
