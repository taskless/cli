import { describe, expect, it, vi } from "vitest";

const fakeCancelSymbol = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => value === fakeCancelSymbol,
}));

describe("ask wrapper", () => {
  it("returns the prompt's resolved value", async () => {
    const { ask } = await import("../src/wizard/ask");
    const value = await ask("locations", () => Promise.resolve(".claude"));
    expect(value).toBe(".claude");
  });

  it("throws WizardCancelled when the prompt returns a cancel symbol", async () => {
    const { ask, WizardCancelled } = await import("../src/wizard/ask");
    await expect(
      ask("locations", () => Promise.resolve(fakeCancelSymbol))
    ).rejects.toBeInstanceOf(WizardCancelled);
  });

  it("the thrown error carries the step name", async () => {
    const { ask, WizardCancelled } = await import("../src/wizard/ask");
    try {
      await ask("summary", () => Promise.resolve(fakeCancelSymbol));
      expect.fail("expected WizardCancelled");
    } catch (error) {
      expect(error).toBeInstanceOf(WizardCancelled);
      expect((error as InstanceType<typeof WizardCancelled>).step).toBe(
        "summary"
      );
    }
  });
});

describe("locationChoices", () => {
  it("offers every shim target and never the canonical .taskless store", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const values = locationChoices([]).options.map((o) => o.value);
    expect(values).toEqual([".claude", ".cursor", ".opencode", ".agents"]);
    expect(values).not.toContain(".taskless");
  });

  it("names the detected .agents harnesses on the .agents/ row", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const named = (names: string[]) =>
      locationChoices(TOOLS.filter((t) => names.includes(t.name))).options.find(
        (o) => o.value === ".agents"
      )?.label;

    // Catalog order, whatever order they were detected in.
    expect(named(["Codex", "OpenCode"])).toBe(
      "OpenCode, Codex, and other .agents harnesses (.agents/)"
    );
    expect(named(["Crush"])).toBe(
      "Crush, and other .agents harnesses (.agents/)"
    );
  });

  // On a fresh machine nothing is detected, and a Codex user scanning for
  // "Codex" still has to find it.
  it("names every known .agents harness when none is detected", async () => {
    const { agentsRowLabel } = await import("../src/wizard/steps/locations");
    expect(agentsRowLabel([])).toBe(
      "OpenCode, Codex, Gemini CLI, Crush, and other .agents harnesses"
    );
  });

  // OpenCode reads `.agents/skills`, so it is named, but it already gets
  // `.opencode/`; pre-checking both would give it the skill twice.
  it("names OpenCode on the .agents/ row without pre-checking it", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const opencode = TOOLS.find((t) => t.name === "OpenCode")!;

    const { options, initialValues } = locationChoices([opencode]);
    const agents = options.find((o) => o.value === ".agents");
    expect(agents?.label).toMatch(/^OpenCode, and other/);
    expect(agents?.hint).toBe("not detected");
    expect(initialValues).toEqual([".opencode"]);
  });

  it("pre-checks .agents/ for Gemini CLI and Crush", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    for (const name of ["Gemini CLI", "Crush"]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      const { options, initialValues } = locationChoices([tool]);
      expect(initialValues, name).toEqual([".agents"]);
      expect(options.find((o) => o.value === ".agents")?.hint, name).toBe(
        "detected"
      );
    }
  });

  it("pre-checks .agents/ when no tools are detected", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    expect(locationChoices([]).initialValues).toEqual([".agents"]);
  });

  it("pre-checks a detected tool and hints it as detected", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const claude = TOOLS.find((t) => t.name === "Claude Code")!;

    const { options, initialValues } = locationChoices([claude]);
    expect(initialValues).toEqual([".claude"]);
    expect(options.find((o) => o.value === ".claude")?.hint).toBe("detected");
    expect(options.find((o) => o.value === ".cursor")?.hint).toBe(
      "not detected"
    );
  });

  it("pre-checks every detected tool's directory", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const claude = TOOLS.find((t) => t.name === "Claude Code")!;
    const codex = TOOLS.find((t) => t.name === "Codex")!;

    const { initialValues } = locationChoices([claude, codex]);
    expect(initialValues).toContain(".claude");
    expect(initialValues).toContain(".agents");
  });

  it("pre-checks a manifest-recorded location with no detected tool", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { options, initialValues } = locationChoices([], [".agents"]);
    expect(initialValues).toEqual([".agents"]);
    expect(options.find((o) => o.value === ".agents")?.hint).toBe("installed");
  });

  it("pre-checks the union of manifest and detected directories", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const claude = TOOLS.find((t) => t.name === "Claude Code")!;

    const { options, initialValues } = locationChoices([claude], [".agents"]);
    expect(initialValues).toEqual([".claude", ".agents"]);
    expect(options.find((o) => o.value === ".claude")?.hint).toBe("detected");
    expect(options.find((o) => o.value === ".agents")?.hint).toBe("installed");
  });

  it("hints a location as installed even when its tool is also detected", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const claude = TOOLS.find((t) => t.name === "Claude Code")!;

    const { options } = locationChoices([claude], [".claude"]);
    expect(options.find((o) => o.value === ".claude")?.hint).toBe("installed");
  });

  it("ignores the canonical .taskless store recorded in the manifest", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { options, initialValues } = locationChoices([], [".taskless"]);
    // .taskless is filtered out, so nothing is pre-checked from the manifest
    // and the first-run .agents/ default applies.
    expect(initialValues).toEqual([".agents"]);
    expect(options.map((o) => o.value)).not.toContain(".taskless");
    expect(options.find((o) => o.value === ".agents")?.hint).toBe(
      "not detected"
    );
  });

  it("pre-checks .agents/ exactly once when Codex is detected", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const codex = TOOLS.find((t) => t.name === "Codex")!;

    const { initialValues } = locationChoices([codex]);
    expect(initialValues).toEqual([".agents"]);
  });

  it("falls back to .agents/ when neither manifest nor detection has entries", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    expect(locationChoices([], []).initialValues).toEqual([".agents"]);
  });
});

function diffEntry(
  target: string,
  removedSkills: string[],
  removedCommands: string[] = [],
  mode: "reference" | "canonical" = "reference"
) {
  return {
    target,
    mode,
    additions: { skills: [], commands: [] },
    removals: { skills: removedSkills, commands: removedCommands },
    unchanged: { skills: [], commands: [] },
  };
}

describe("buildRemovalConfirmMessage", () => {
  it("itemizes each target losing stubs with its count", async () => {
    const { buildRemovalConfirmMessage } =
      await import("../src/wizard/steps/summary");
    const message = buildRemovalConfirmMessage({
      entries: [
        diffEntry(".claude", ["taskless"], ["tskl.md"]),
        diffEntry(".cursor", ["taskless"]),
      ],
      hasAdditions: false,
      hasRemovals: true,
    });
    expect(message).toBe(
      "Remove Taskless from .claude/ (2 stubs), .cursor/ (1 stub)?"
    );
  });

  it("skips targets with no removals", async () => {
    const { buildRemovalConfirmMessage } =
      await import("../src/wizard/steps/summary");
    const message = buildRemovalConfirmMessage({
      entries: [diffEntry(".agents", []), diffEntry(".cursor", ["taskless"])],
      hasAdditions: false,
      hasRemovals: true,
    });
    expect(message).toBe("Remove Taskless from .cursor/ (1 stub)?");
  });

  it("excludes canonical-store removals from the itemized list", async () => {
    const { buildRemovalConfirmMessage } =
      await import("../src/wizard/steps/summary");
    const message = buildRemovalConfirmMessage({
      entries: [
        diffEntry(".taskless", ["old-skill"], [], "canonical"),
        diffEntry(".cursor", ["taskless"]),
      ],
      hasAdditions: false,
      hasRemovals: true,
    });
    expect(message).toBe("Remove Taskless from .cursor/ (1 stub)?");
    expect(message).not.toContain(".taskless/");
  });

  it("falls back to a generic prompt when only the canonical store loses files", async () => {
    const { buildRemovalConfirmMessage } =
      await import("../src/wizard/steps/summary");
    const message = buildRemovalConfirmMessage({
      entries: [diffEntry(".taskless", ["old-skill"], [], "canonical")],
      hasAdditions: false,
      hasRemovals: true,
    });
    expect(message).toBe(
      "Some files recorded in the previous install will be removed. Proceed?"
    );
  });
});
