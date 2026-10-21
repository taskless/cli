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

/** The locations step, and catalog harnesses by name. */
async function load() {
  const steps = await import("../src/wizard/steps/locations");
  const { TOOLS } = await import("../src/install/install");
  const tools = (...names: string[]) =>
    TOOLS.filter((tool) => names.includes(tool.name));
  return { ...steps, tools };
}

describe("locationChoices", () => {
  it("offers a row for every harness with nothing detected", async () => {
    const { locationChoices, OTHER_SECTION } = await load();
    const { groups } = locationChoices([]);
    expect(Object.keys(groups)).toEqual([OTHER_SECTION]);
    expect(groups[OTHER_SECTION]!.map((row) => row.label)).toEqual([
      "Claude Code (.claude/)",
      "OpenCode (.opencode/)",
      "Cursor (.cursor/)",
      "Codex (.agents/)",
      "Gemini CLI (.agents/)",
      "Crush (.agents/)",
      "Devin (.agents/)",
      "Other Agent Skills harnesses (.agents/)",
    ]);
  });

  it("pre-checks project-detected harnesses in their own section", async () => {
    const { locationChoices, tools, PROJECT_SECTION } = await load();
    const { groups, initialValues } = locationChoices(
      tools("Claude Code", "Codex")
    );
    expect(groups[PROJECT_SECTION]!.map((row) => row.value)).toEqual([
      "Claude Code",
      "Codex",
    ]);
    expect(initialValues).toEqual(["Claude Code", "Codex"]);
  });

  it("lists machine-detected harnesses unchecked", async () => {
    const { locationChoices, tools, MACHINE_SECTION } = await load();
    const { groups, initialValues } = locationChoices(
      tools("Claude Code"),
      tools("Gemini CLI")
    );
    expect(groups[MACHINE_SECTION]!.map((row) => row.value)).toEqual([
      "Gemini CLI",
    ]);
    expect(initialValues).toEqual(["Claude Code"]);
  });

  it("lists a harness found in both places once, in the project section", async () => {
    const { locationChoices, tools, PROJECT_SECTION } = await load();
    const { groups } = locationChoices(
      tools("Claude Code"),
      tools("Claude Code")
    );
    const rows = Object.values(groups)
      .flat()
      .filter((row) => row.value === "Claude Code");
    expect(rows).toHaveLength(1);
    expect(groups[PROJECT_SECTION]).toEqual(rows);
  });

  it("orders the sections project, machine, other", async () => {
    const {
      locationChoices,
      tools,
      PROJECT_SECTION,
      MACHINE_SECTION,
      OTHER_SECTION,
    } = await load();
    // Claude Code, first in the catalog, fills the machine section before
    // Codex fills the project one; the sections still come out in order.
    const { groups } = locationChoices(tools("Codex"), tools("Claude Code"));
    expect(Object.keys(groups)).toEqual([
      PROJECT_SECTION,
      MACHINE_SECTION,
      OTHER_SECTION,
    ]);
  });

  it("pre-checks only the generic row with nothing detected or installed", async () => {
    const { locationChoices, tools, GENERIC_ROW } = await load();
    expect(locationChoices([], tools("Codex")).initialValues).toEqual([
      GENERIC_ROW,
    ]);
  });

  it("pre-checks the generic row for a recorded .agents/ no detected harness covers", async () => {
    const { locationChoices, tools, GENERIC_ROW } = await load();
    const { groups, initialValues } = locationChoices(
      tools("Claude Code"),
      [],
      [".agents"]
    );
    expect(initialValues).toEqual(["Claude Code", GENERIC_ROW]);
    const generic = Object.values(groups)
      .flat()
      .find((row) => row.value === GENERIC_ROW);
    expect(generic?.hint).toBe("installed");
  });

  it("does not add the generic row when a detected harness covers .agents/", async () => {
    const { locationChoices, tools } = await load();
    const { groups, initialValues } = locationChoices(
      tools("Codex"),
      [],
      [".agents"]
    );
    expect(initialValues).toEqual(["Codex"]);
    const codex = Object.values(groups)
      .flat()
      .find((row) => row.value === "Codex");
    expect(codex?.hint).toBe("installed");
  });

  it("hints only installed rows", async () => {
    const { locationChoices, tools } = await load();
    const { groups } = locationChoices(tools("Claude Code"), tools("Codex"));
    expect(
      Object.values(groups)
        .flat()
        .filter((row) => row.hint !== undefined)
    ).toEqual([]);
  });

  it("ignores a recorded .taskless/", async () => {
    const { locationChoices, GENERIC_ROW } = await load();
    const { groups, initialValues } = locationChoices([], [], [".taskless"]);
    expect(initialValues).toEqual([GENERIC_ROW]);
    expect(
      Object.values(groups)
        .flat()
        .some((row) => row.label.includes(".taskless"))
    ).toBe(false);
  });

  it("labels Devin with .devin/ when the project has it", async () => {
    const { locationChoices, tools, PROJECT_SECTION } = await load();
    const { groups } = locationChoices(tools("Devin"));
    expect(groups[PROJECT_SECTION]!.map((row) => row.label)).toEqual([
      "Devin (.devin/)",
    ]);
  });
});

describe("resolveSelection", () => {
  it("installs two rows sharing .agents/ once", async () => {
    const { resolveSelection } = await load();
    expect(resolveSelection(["Codex", "Gemini CLI"], []).directories).toEqual([
      ".agents",
    ]);
  });

  it("returns directories in plan order and harnesses without the generic row", async () => {
    const { resolveSelection, GENERIC_ROW } = await load();
    expect(resolveSelection([GENERIC_ROW, "Codex", "Claude Code"], [])).toEqual(
      {
        directories: [".claude", ".agents"],
        harnesses: ["Claude Code", "Codex"],
      }
    );
  });

  it("installs a machine-only Claude Code into .claude/", async () => {
    const { resolveSelection } = await load();
    expect(resolveSelection(["Claude Code"], []).directories).toEqual([
      ".claude",
    ]);
  });

  it("installs Devin into .devin/ only when the project has it", async () => {
    const { resolveSelection, tools } = await load();
    expect(resolveSelection(["Devin"], []).directories).toEqual([".agents"]);
    expect(resolveSelection(["Devin"], tools("Devin")).directories).toEqual([
      ".devin",
    ]);
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

  it("folds the settings changes into the same question", async () => {
    const { buildRemovalConfirmMessage } =
      await import("../src/wizard/steps/summary");
    const message = buildRemovalConfirmMessage(
      {
        entries: [diffEntry(".claude", ["taskless"])],
        hasAdditions: false,
        hasRemovals: true,
      },
      { editsSettings: true }
    );
    expect(message).toBe(
      "Remove Taskless from .claude/ (1 stub), and make these changes to your settings?"
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
