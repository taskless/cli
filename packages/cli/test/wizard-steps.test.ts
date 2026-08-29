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
      await ask("auth", () => Promise.resolve(fakeCancelSymbol));
      expect.fail("expected WizardCancelled");
    } catch (error) {
      expect(error).toBeInstanceOf(WizardCancelled);
      expect((error as InstanceType<typeof WizardCancelled>).step).toBe("auth");
    }
  });
});

describe("locationChoices", () => {
  it("offers every shim target and never the canonical .taskless store", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const values = locationChoices([]).options.map((o) => o.value);
    expect(values).toEqual([
      ".claude",
      ".agents",
      ".cursor",
      ".opencode",
      ".agents",
    ]);
    expect(values).not.toContain(".taskless");
  });

  it("names Codex in the picker, alongside the generic .agents/ entry", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const labels = locationChoices([]).options.map((o) => o.label);
    // Both rows are offered on purpose: a Codex user scans for "Codex", and
    // "Agent Skills" still serves harnesses the catalog does not enumerate.
    expect(labels).toContain("Codex (.agents/)");
    expect(labels).toContain("Agent Skills (.agents/)");
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
    // Two rows share `.agents/`, so the hint is looked up by label: the
    // generic hint belongs to the generic row, not to the Codex one.
    expect(options.find((o) => o.label.startsWith("Agent Skills"))?.hint).toBe(
      "generic agent skills"
    );
    expect(options.find((o) => o.label.startsWith("Codex"))?.hint).toBe(
      "not detected"
    );
  });

  it("pre-checks .agents/ exactly once when Codex is detected", async () => {
    const { locationChoices } = await import("../src/wizard/steps/locations");
    const { TOOLS } = await import("../src/install/install");
    const codex = TOOLS.find((t) => t.name === "Codex")!;

    // Codex and Agent Skills both offer `.agents/`; the pre-checked set is
    // directories, so it must name that directory once.
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
