import { describe, expect, it } from "vitest";

import {
  getInstructions,
  getPrompt,
  getRawInstructions,
  TOPICS,
} from "../../src/prompts/index";
import { getRecipe } from "../../src/prompts/recipes";
import {
  buildInvocation,
  isProductionInvocation,
} from "../../src/util/invocation";
import { CLI_VERSION } from "../../src/version";

/**
 * taskless/cli#469, under the `nightly` vitest project (see `vite.config.ts`),
 * where `__TASKLESS_CLI__` is a pinned `@taskless/cli-nightly@<version>`.
 *
 * `@taskless/cli/prompts` fell back to the BUILD's invocation when the caller
 * passed none, so a nightly rendered `npx @taskless/cli-nightly@<version>`
 * into every recipe body. A release build falls back to the agent-fill marker
 * instead, which is why 0.11.2 rendered no version and the nightly rendered
 * eleven. The importing host never launched this package, so how this build
 * would be launched says nothing about its reader; and with `header: false`
 * the version in the body defeated the cache stability the option exists for.
 */
const VERSIONED_INVOCATION = /@taskless\/cli[\w-]*@[\w.-]+/;

describe("the prompts export under a nightly build", () => {
  it("runs under a nightly define, not the released one", () => {
    expect(isProductionInvocation()).toBe(false);
    expect(buildInvocation()).toContain("@taskless/cli-nightly@");
  });

  for (const topic of TOPICS) {
    it(`renders ${topic} with no CLI version when the header is suppressed`, () => {
      const options = { header: false, mechanics: false };
      for (const text of [
        getPrompt(topic, options),
        getInstructions(topic, options).text,
        getRawInstructions(topic, options).text,
      ]) {
        expect(text).not.toMatch(VERSIONED_INVOCATION);
        expect(text).not.toContain(CLI_VERSION);
      }
    });

    it(`renders ${topic} with the agent-fill marker when no invocation is passed`, () => {
      const text = getPrompt(topic);
      expect(text).not.toMatch(VERSIONED_INVOCATION);
      expect(text).toContain("<taskless-cli>");
    });

    it(`renders ${topic} with a caller-supplied invocation verbatim`, () => {
      const text = getPrompt(topic, { invocation: "pnpm dlx @taskless/cli" });
      expect(text).toContain("pnpm dlx @taskless/cli agent");
      expect(text).not.toContain("<taskless-cli>");
    });
  }

  it("still names the nightly itself on the CLI's own render path", () => {
    // `taskless agent <topic>` IS this build, so when the launcher cannot be
    // detected its own pinned invocation remains the right answer there.
    expect(getRecipe("route")).toContain(`${buildInvocation()} agent`);
  });
});
