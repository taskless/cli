import { describe, expect, it } from "vitest";

import { buildReadmeContent } from "../src/filesystem/migrations/0001-init";
import { buildInvocation } from "../src/util/invocation";
import { pinnedSpecifier } from "../src/util/package-manager";

/**
 * `.taskless/README.md` is persisted into the user's repository and rewritten
 * on every migration run, so what it names is shipped content rather than a
 * transient console line.
 *
 * The specifier is passed in rather than read from the build define, because a
 * test process is always a prod build. That is exactly why a nightly could go
 * on naming `@taskless/cli@latest` unnoticed: the only build that got it wrong
 * was the only build no test could reach.
 */
const NIGHTLY_SPECIFIER = "@taskless/cli-nightly@0.11.0-20260824213902xf26a7b0";
const RELEASED_SPECIFIER = "@taskless/cli@latest";

/** What `pinnedSpecifier()` returns for a path-form (`self`) build. */
const NO_SPECIFIER: string | undefined = undefined;

describe("buildReadmeContent", () => {
  it("offers both launchers for a released build", () => {
    const readme = buildReadmeContent(RELEASED_SPECIFIER);
    expect(readme).toContain(`pnpm dlx ${RELEASED_SPECIFIER} check`);
    expect(readme).toContain(`npx ${RELEASED_SPECIFIER} check`);
  });

  it("keeps both launchers for a nightly, and names the nightly in both", () => {
    const readme = buildReadmeContent(NIGHTLY_SPECIFIER);
    expect(readme).toContain(`pnpm dlx ${NIGHTLY_SPECIFIER} check`);
    expect(readme).toContain(`npx ${NIGHTLY_SPECIFIER} check`);
  });

  it("never names the released package in a nightly's README", () => {
    // The regression. Routing only the `npx` spelling through the rewrite
    // corrected one line and left the other telling a nightly's reader to
    // install the release over the build they had just installed.
    const readme = buildReadmeContent(NIGHTLY_SPECIFIER);
    expect(readme).not.toContain(RELEASED_SPECIFIER);
    expect(readme).not.toContain("@taskless/cli@");
  });

  it("names its one invocation for a path-form build", () => {
    // A `self` build's invocation is `node <path>`, which no launcher fronts.
    // `pnpm dlx node packages/cli/dist-self/index.js` is not a command, so the
    // launcher menu is dropped rather than filled in with nonsense.
    const readme = buildReadmeContent(NO_SPECIFIER);
    expect(readme).toContain(`${buildInvocation()} check`);
    expect(readme).not.toContain("pnpm dlx");
  });

  it("is the same bytes however this process was launched", () => {
    // Byte stability matters because many projects commit this file and the
    // migration overwrites it on every run. The specifier is the only input,
    // and it is a build-time constant, so nothing here can vary per launch.
    expect(buildReadmeContent(pinnedSpecifier())).toBe(
      buildReadmeContent(pinnedSpecifier())
    );
    expect(pinnedSpecifier()).toBe(RELEASED_SPECIFIER);
  });
});
