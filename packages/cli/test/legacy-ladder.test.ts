import { describe, expect, it } from "vitest";

import { CUSTOM_RULE_THRESHOLD } from "../src/detect/custom-rule-threshold";
import { getRawRecipe, getRecipe } from "../src/prompts/recipes";

function recipe(topic: string): string {
  const text = getRecipe(topic);
  if (text === undefined) throw new Error(`no recipe for ${topic}`);
  return text;
}

function tool(name: string): string {
  const text = getRecipe("create-legacy-rule", { tool: name });
  if (text === undefined) throw new Error(`no recipe for ${name}`);
  return text;
}

describe("route's legacy ladder", () => {
  const route = recipe("route");

  it("is topic v12", () => {
    expect(route).toMatch(/^# Topic: route {5}\(CLI v.+ \/ topic v12\)/m);
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

// #675: route's own questions must yield to a recipe that limits asking,
// such as onboard, or reading the two together gives two answers.
describe("route's questions defer to the recipe that sent the agent", () => {
  const route = recipe("route");
  const flat = route.replaceAll(/\s+/g, " ");

  it("says a calling recipe's limits win, naming every question", () => {
    expect(flat).toContain("**Another recipe may have sent you here.**");
    expect(flat).toContain(
      "its limits win over every question this recipe asks: step 7's choice, the clarifying question under \"When two destinations both fit\", and the failure fallback's confirmation."
    );
  });

  // A limiting recipe that reads only this precondition must learn that the
  // destination recipes ask too, or it misses their confirmations.
  it("names the questions each destination recipe asks on its own", () => {
    expect(flat).toContain(
      "Those limits also cover the recipes this one sends you to, which ask their own questions:"
    );
    expect(flat).toContain(
      "`create-sg-rule`: confirms exclusions, asks whether to improve an overlapping rule, and asks before escalating a failed rule."
    );
    expect(flat).toContain(
      "`create-legacy-rule`: asks which linter owns the rule when more than one could, and before adding a plugin the repo does not have."
    );
    expect(flat).toContain("Ruff's asks before turning on preview mode.");
    expect(flat).toContain(
      "`create-runtime-rule`: asks whether the user wants an account."
    );
    expect(flat).toContain(
      "`create-remote-rule`: asks about an overlapping rule, asks for the cases, and confirms before spending a generation."
    );
    expect(flat).toContain("`create-vale-rule` asks nothing.");
  });

  it("qualifies step 7's choice, the clarifying question, and the fallback in place", () => {
    expect(flat).toContain(
      "If a recipe that limits questions sent you here, do not offer the choice"
    );
    expect(flat).toContain(
      "ask the user a clarifying question, unless a recipe that limits questions sent you here; then that recipe decides."
    );
    expect(flat).toContain(
      "If a recipe that limits questions sent you here, do not ask for that confirmation; do what that recipe says instead."
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
      "During onboarding do not write a custom rule in any linter,\nhowever many the repo has, and do not add a dependency."
    );
  });
});

describe("the per-tool legacy recipes", () => {
  it("has Ruff try banned-api before anything else", () => {
    const ruff = tool("ruff");
    const banned = ruff.indexOf("**Always check `banned-api` first.**");
    expect(banned).toBeGreaterThan(-1);
    expect(banned).toBeLessThan(
      ruff.indexOf("**Otherwise, find a shipped rule.**")
    );
    expect(ruff).toContain("`ruff rule <code-or-name>`");
    expect(ruff).toContain(
      "Never enable a preview rule in a\n     configuration where it cannot fire."
    );
  });

  it("has ESLint try a core rule before a plugin", () => {
    const eslint = tool("eslint");
    const core = eslint.indexOf("**Always try a core rule first.**");
    expect(core).toBeGreaterThan(-1);
    expect(core).toBeLessThan(
      eslint.indexOf("**Then a plugin, preferring one already installed.**")
    );
  });

  it("gives every curated ESLint plugin a summary and a docs link", () => {
    const eslint = tool("eslint");
    for (const plugin of [
      "eslint-plugin-import",
      "eslint-plugin-regexp",
      "eslint-plugin-promise",
      "eslint-plugin-n",
      "eslint-plugin-react",
      "eslint-plugin-react-hooks",
      "eslint-plugin-jsx-a11y",
      "eslint-plugin-sonarjs",
    ]) {
      expect(eslint).toMatch(
        new RegExp(
          String.raw`- \`${plugin}\`: [^\n]+(?:\n {5}[^\n]+)*\n? *https://`
        )
      );
    }
    expect(eslint).toContain("`eslint-plugin-import-x`");
  });

  it("has Biome check its catch-alls and confirm with biome explain", () => {
    const biome = tool("biome");
    expect(biome).toContain("`noRestrictedImports`");
    expect(biome).toContain("`noRestrictedGlobals`");
    expect(biome).toContain("`biome explain <ruleName>`");
    expect(biome).toContain("Do not write a Biome plugin.");
  });

  it("has Oxlint check its catch-alls and confirm with oxlint --rules --format default", () => {
    const oxlint = tool("oxlint");
    expect(oxlint).toContain("`no-restricted-imports`");
    expect(oxlint).toContain("`no-restricted-globals`");
    expect(oxlint).toContain("Oxlint has no `no-restricted-syntax`.");
    expect(oxlint).toContain("`oxlint --rules --format default`");
    expect(oxlint).toContain("a nested\n   config replaces its parent");
    expect(oxlint).toContain("Do not write an Oxlint plugin.");
  });

  it("has pylint load an extension before ruling its message out", () => {
    expect(tool("pylint")).toContain(
      "Load the extension\n   before concluding a message does not exist."
    );
  });

  it("sends flake8 straight to banned-modules with no discovery step", () => {
    const flake8 = tool("flake8");
    expect(flake8).toContain("**Use `banned-modules`.**");
    expect(flake8).not.toContain("--list");
  });

  it.each(["ruff", "eslint", "biome", "oxlint", "pylint", "flake8"])(
    "has the %s recipe say Taskless does not run the linter",
    (name) => {
      expect(tool(name)).toMatch(/check` does NOT run /);
    }
  );
});

describe("the custom-rule threshold", () => {
  // The detector compares `customRules.count` against this constant, and the
  // recipes quote it from the same place rather than by hand (taskless/cli#651).
  const sources: [string, string | undefined][] = [
    ["route", undefined],
    ["create-legacy-rule", undefined],
    ["create-legacy-rule", "eslint"],
    ["create-legacy-rule", "flake8"],
    ["create-legacy-rule", "pylint"],
  ];

  it.each(sources)("%s %s quotes the constant, not a copy", (topic, name) => {
    const raw = getRawRecipe(topic, { tool: name })?.text ?? "";
    expect(raw).toContain("%(CUSTOM_RULE_THRESHOLD)s or more");
    expect(raw).not.toMatch(/\b(?:5|five) or more\b|Fewer than 5\b/);

    const rendered = getRecipe(topic, { tool: name }) ?? "";
    expect(rendered).toContain(`${CUSTOM_RULE_THRESHOLD} or more`);
  });
});
