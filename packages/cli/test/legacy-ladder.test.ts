import { describe, expect, it } from "vitest";

import { getRecipe } from "../src/prompts/recipes";

function recipe(topic: string): string {
  const text = getRecipe(topic);
  if (text === undefined) throw new Error(`no recipe for ${topic}`);
  return text;
}

describe("route's legacy ladder", () => {
  const route = recipe("route");

  it("is topic v8", () => {
    expect(route).toMatch(/^# Topic: route {5}\(CLI v.+ \/ topic v8\)/m);
  });

  it("orders shipped rule, repo examples, Taskless static, Taskless runtime", () => {
    const steps = [
      "**A rule the linter already ships solves it.**",
      "**The repo already writes its own rules for that linter.**",
      "**A Taskless `sg` or `vale` rule**",
      "**A Taskless runtime rule**",
    ].map((step) => route.indexOf(step));
    expect(steps.every((index) => index !== -1)).toBe(true);
    expect(steps).toEqual(steps.toSorted((a, b) => a - b));
  });

  it("gates step 2 on five custom rules and treats unknown as below it", () => {
    expect(route).toContain("`customRules.count` of 5 or more");
    expect(route).toContain(
      'An\n      `"unknown"` count is below the threshold.'
    );
  });

  it("does not pose a legacy rule against a Taskless rule as a choice", () => {
    expect(route).toContain("do not ask. The legacy ladder in step 4 decides");
    expect(route).not.toContain(
      "Present both with trade-offs and let the user\n  choose."
    );
  });
});

describe("the generic legacy recipe", () => {
  const legacy = recipe("create-legacy-rule");

  it("is topic v3", () => {
    expect(legacy).toMatch(
      /^# Topic: create-legacy-rule {5}\(CLI v.+ \/ topic v3\)/m
    );
  });

  it("looks for a shipped rule, catch-alls by name, before anything else", () => {
    const shipped = legacy.indexOf(
      "**Look for a rule the tool already ships.**"
    );
    const custom = legacy.indexOf(
      "**No shipped rule fits: check the repo's own rules.**"
    );
    expect(shipped).toBeGreaterThan(-1);
    expect(custom).toBeGreaterThan(shipped);
    for (const catchAll of [
      "`no-restricted-syntax`",
      "`no-restricted-imports`",
      "`banned-api`",
      "`noRestrictedImports`",
      "`deprecated-modules`",
    ]) {
      expect(legacy).toContain(catchAll);
    }
  });

  it("writes a custom rule only from five of the repo's own", () => {
    expect(legacy).toContain(
      "**A `count` of 5 or more:** you may write a new rule."
    );
    expect(legacy).toContain(
      '**Fewer than 5, `"unknown"`, or no `customRules` at all:** do not\n     write a custom rule.'
    );
  });

  it("asks before adding a plugin the repo does not have", () => {
    expect(legacy).toContain(
      "**A plugin the repo does not have is a new dependency.**"
    );
  });

  it("says Taskless does not run the linter", () => {
    expect(legacy).toContain("check` does NOT execute external linters");
  });
});

describe("onboarding's legacy limits", () => {
  const onboard = recipe("onboard");

  it("never writes a custom linter rule or adds a dependency", () => {
    expect(onboard).toContain(
      "During onboarding do not write a custom rule in any linter,\n   however many the repo has, and do not add a dependency."
    );
  });
});
