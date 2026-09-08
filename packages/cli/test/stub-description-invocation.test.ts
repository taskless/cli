import { describe, expect, it } from "vitest";

import { getEmbeddedCommands, getEmbeddedSkills } from "../src/install/install";

/**
 * Regression coverage for taskless/cli#298.
 *
 * `getEmbeddedSkills`/`getEmbeddedCommands` read `name`/`description` straight
 * out of a skill or command's raw frontmatter — the exact text later copied
 * verbatim into a `.claude`/`.agents`/etc. reference stub's own frontmatter
 * (see `writeSkill`/`writeCommand` in `src/install/install.ts`, which pass
 * `skill.description`/`command.description` through unchanged as
 * `StubFrontmatter.description`).
 *
 * That copy is NEVER routed through `applyCliInvocation`: only a canonical
 * `.taskless/` file gets that rewrite (`writeCanonicalSkill`/
 * `writeCanonicalCommand`). A stub's own frontmatter is deliberately kept
 * byte-stable across releases so it does not churn on every version bump
 * (see the `StubFrontmatter` doc comment in `src/install/canonical.ts`) — and
 * `stubFrontmatterDrifted` only rewrites a stub when `name`/`description`
 * actually change, so a CLI invocation baked into `description` freezes there
 * across every later `init`, nightly or not.
 *
 * The fix is to never let a CLI invocation reach `description` in the first
 * place — there is then no second, unrewritten copy for a stub to freeze. This
 * test enforces that structurally: it fails if ANY embedded skill or command's
 * `description` names the CLI, pinned or not, so a future author cannot
 * reintroduce the class of bug by adding an invocation back into a
 * `description:` field.
 *
 * Mutation check performed by hand: restoring the pinned literal
 * `` `npx @taskless/cli agent route` `` inside `skills/taskless/SKILL.md`'s
 * `description:` field made this test fail (both assertions below); reverting
 * made it pass again.
 */
describe("skill/command descriptions never name the CLI package", () => {
  // The one substring every form of the invocation shares: the released
  // package (`npx @taskless/cli`) and a nightly's pinned form
  // (`npx @taskless/cli-nightly@<version>`) both contain `@taskless/cli`. A
  // bare `taskless` (the product name, used all over these descriptions in
  // ordinary prose — "run taskless", "wire taskless into CI") is not this bug:
  // it names no package and carries no version, so it cannot go stale across
  // a channel or version change the way `@taskless/cli[-nightly]` can.
  const NAMES_THE_CLI_PACKAGE = /@taskless\/cli/;

  it("no embedded skill's description carries a CLI invocation", () => {
    for (const skill of getEmbeddedSkills()) {
      expect(
        skill.description,
        `skill "${skill.name}" description names the CLI package`
      ).not.toMatch(NAMES_THE_CLI_PACKAGE);
    }
  });

  it("no embedded command's description carries a CLI invocation", () => {
    for (const command of getEmbeddedCommands()) {
      expect(
        command.description,
        `command "${command.filename}" description names the CLI package`
      ).not.toMatch(NAMES_THE_CLI_PACKAGE);
    }
  });
});
