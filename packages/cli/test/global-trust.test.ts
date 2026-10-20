import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  describeGlobalTrust,
  GLOBAL_TRUST_ENTRY,
  globalTrustWarnings,
  NIGHTLY_TRUST,
  RELEASE_TRUST,
  syncGlobalTrust,
  type GlobalTrustEnvironment,
} from "../src/install/global-trust";

let home: string;
let environment: GlobalTrustEnvironment;
let settings: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taskless-global-trust-"));
  environment = { home, env: {} };
  settings = join(home, ".claude", "settings.json");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function put(contents: string): Promise<void> {
  await mkdir(dirname(settings), { recursive: true });
  await writeFile(settings, contents);
}

async function read(): Promise<string> {
  return readFile(settings, "utf8");
}

function sync(write: boolean, selected: string[] = [".claude"]) {
  return syncGlobalTrust({ selected, write, environment });
}

describe("the entry", () => {
  it("begins with its label and names no real version", () => {
    expect(GLOBAL_TRUST_ENTRY.startsWith("Taskless CLI:")).toBe(true);
    // The only version-shaped text is the fixed example.
    expect(GLOBAL_TRUST_ENTRY.match(/\d+\.\d+\.\d+/g)).toEqual(["1.2.3"]);
  });

  it("states the pin requirement and excludes @latest", () => {
    expect(GLOBAL_TRUST_ENTRY).toContain(
      "only when the call names an exact version"
    );
    expect(GLOBAL_TRUST_ENTRY).toContain("@latest");
    expect(GLOBAL_TRUST_ENTRY).toContain("not covered");
  });

  it("is the release's entry in the released build", () => {
    expect(GLOBAL_TRUST_ENTRY).toBe(RELEASE_TRUST.entry);
  });

  it("names one package per entry, under labels that never match each other", () => {
    expect(RELEASE_TRUST.entry.startsWith("Taskless CLI:")).toBe(true);
    expect(RELEASE_TRUST.entry).toContain("@taskless/cli is");
    expect(RELEASE_TRUST.entry).not.toContain("cli-nightly");

    expect(NIGHTLY_TRUST.entry.startsWith("Taskless CLI nightly:")).toBe(true);
    expect(NIGHTLY_TRUST.entry).toContain("@taskless/cli-nightly is");
    expect(NIGHTLY_TRUST.entry.match(/\d+\.\d+\.\d+/g)).toEqual(["1.2.3"]);

    expect(NIGHTLY_TRUST.entry.startsWith(RELEASE_TRUST.label)).toBe(false);
    expect(RELEASE_TRUST.entry.startsWith(NIGHTLY_TRUST.label)).toBe(false);
  });

  it("covers the call inside shell plumbing, and only the call", () => {
    expect(GLOBAL_TRUST_ENTRY).toContain(
      "sets a variable, changes or creates a directory, or redirects the call's output to a file"
    );
    expect(GLOBAL_TRUST_ENTRY).toContain(
      "every other command on the line is judged on its own"
    );
  });
});

describe("syncGlobalTrust", () => {
  it("seeds a new list with $defaults when the file is absent", async () => {
    const outcomes = await sync(true);

    expect(outcomes).toEqual([
      {
        harness: "Claude Code",
        file: settings,
        key: "autoMode.allow",
        state: "written",
        skipped: null,
        labelled: 0,
      },
    ]);
    expect(JSON.parse(await read())).toEqual({
      autoMode: { allow: ["$defaults", GLOBAL_TRUST_ENTRY] },
    });
  });

  it("adds autoMode to an existing file and keeps every other key", async () => {
    await put('{\n  "model": "opus",\n  "permissions": { "allow": [] }\n}\n');
    await sync(true);

    expect(JSON.parse(await read())).toEqual({
      model: "opus",
      permissions: { allow: [] },
      autoMode: { allow: ["$defaults", GLOBAL_TRUST_ENTRY] },
    });
  });

  it("appends to an existing list", async () => {
    await put(
      JSON.stringify({
        autoMode: { allow: ["$defaults", "Internal Registry: ours"] },
      })
    );
    await sync(true);

    expect(JSON.parse(await read())).toEqual({
      autoMode: {
        allow: ["$defaults", "Internal Registry: ours", GLOBAL_TRUST_ENTRY],
      },
    });
  });

  it("does not add $defaults to a list that left it out", async () => {
    await put(JSON.stringify({ autoMode: { allow: ["Mine: only this"] } }));
    await sync(true);

    expect(JSON.parse(await read())).toEqual({
      autoMode: { allow: ["Mine: only this", GLOBAL_TRUST_ENTRY] },
    });
  });

  it("leaves the current entry alone", async () => {
    const original = JSON.stringify({
      autoMode: { allow: ["$defaults", GLOBAL_TRUST_ENTRY] },
    });
    await put(original);
    const outcomes = await sync(true);

    expect(outcomes[0]?.state).toBe("present");
    expect(await read()).toBe(original);
  });

  it("reports a reworded entry as stale without writing", async () => {
    const original = JSON.stringify({
      autoMode: {
        allow: ["$defaults", "Taskless CLI: allowed with a pinned version"],
      },
    });
    await put(original);
    const outcomes = await sync(false);

    expect(outcomes[0]?.state).toBe("stale");
    expect(await read()).toBe(original);
  });

  it("replaces a stale entry where it sits", async () => {
    await put(
      JSON.stringify({
        autoMode: {
          allow: [
            "$defaults",
            "Taskless CLI: allowed with a pinned version",
            "Internal Registry: ours",
          ],
        },
      })
    );
    const outcomes = await sync(true);

    expect(outcomes[0]?.state).toBe("written");
    expect(JSON.parse(await read())).toEqual({
      autoMode: {
        allow: ["$defaults", GLOBAL_TRUST_ENTRY, "Internal Registry: ours"],
      },
    });
  });

  it("folds every labelled entry into one, at the first one's place", async () => {
    await put(
      JSON.stringify({
        autoMode: {
          allow: [
            "$defaults",
            GLOBAL_TRUST_ENTRY,
            "Internal Registry: ...",
            "Taskless CLI: pasted by hand",
            NIGHTLY_TRUST.entry,
          ],
        },
      })
    );
    const [before] = await sync(false);
    expect(before).toMatchObject({
      state: "stale",
      labelled: 2,
    });
    await sync(true);

    expect(JSON.parse(await read())).toEqual({
      autoMode: {
        allow: [
          "$defaults",
          GLOBAL_TRUST_ENTRY,
          "Internal Registry: ...",
          NIGHTLY_TRUST.entry,
        ],
      },
    });
  });

  it("reads a duplicated current entry as stale and leaves one copy", async () => {
    await put(
      JSON.stringify({
        autoMode: {
          allow: ["Taskless CLI: old", GLOBAL_TRUST_ENTRY, GLOBAL_TRUST_ENTRY],
        },
      })
    );
    const [before] = await sync(false);
    expect(before?.state).toBe("stale");
    await sync(true);

    expect(JSON.parse(await read())).toEqual({
      autoMode: { allow: [GLOBAL_TRUST_ENTRY] },
    });
    const [after] = await sync(false);
    expect(after).toMatchObject({
      state: "present",
      labelled: 1,
    });
  });

  it("leaves duplicates in place when not writing", async () => {
    const before = JSON.stringify({
      autoMode: { allow: [GLOBAL_TRUST_ENTRY, GLOBAL_TRUST_ENTRY] },
    });
    await put(before);
    await sync(false);
    expect(await read()).toBe(before);
  });

  it("covers its own launcher and not the nightly's", () => {
    expect(GLOBAL_TRUST_ENTRY).toContain("./.taskless/bin/cli.mjs");
    expect(GLOBAL_TRUST_ENTRY).not.toContain("cli-nightly.mjs");
    expect(NIGHTLY_TRUST.entry).toContain("./.taskless/bin/cli-nightly.mjs");
  });

  it("leaves the nightly's entry alone", async () => {
    await put(
      JSON.stringify({
        autoMode: { allow: ["$defaults", NIGHTLY_TRUST.entry] },
      })
    );
    const outcomes = await sync(true);

    expect(outcomes[0]?.state).toBe("written");
    expect(JSON.parse(await read())).toEqual({
      autoMode: {
        allow: ["$defaults", NIGHTLY_TRUST.entry, GLOBAL_TRUST_ENTRY],
      },
    });
  });

  it("never reads an unlabelled entry as ours", async () => {
    await put(
      JSON.stringify({ autoMode: { allow: ["Internal Registry: Taskless"] } })
    );
    const outcomes = await sync(false);

    expect(outcomes[0]?.state).toBe("absent");
  });

  it("only reports when not writing", async () => {
    const original = "{}\n";
    await put(original);
    const outcomes = await sync(false);

    expect(outcomes[0]?.state).toBe("absent");
    expect(await read()).toBe(original);
  });

  it("skips a file that does not parse", async () => {
    await put("{ nope");
    const outcomes = await sync(true);

    expect(outcomes[0]).toMatchObject({
      state: "skipped",
      skipped: "does not parse, so it was left as it is",
    });
    expect(await read()).toBe("{ nope");
  });

  it("skips an autoMode.allow that is not a list", async () => {
    await put(JSON.stringify({ autoMode: { allow: "everything" } }));
    const outcomes = await sync(true);

    expect(outcomes[0]?.skipped).toBe("autoMode.allow is not a list");
  });

  it("keeps comments", async () => {
    await put('{\n  // mine\n  "model": "opus"\n}\n');
    await sync(true);

    expect(await read()).toContain("// mine");
  });

  it("follows CLAUDE_CONFIG_DIR", async () => {
    const elsewhere = join(home, "elsewhere");
    const outcomes = await syncGlobalTrust({
      selected: [".claude"],
      write: true,
      environment: { home, env: { CLAUDE_CONFIG_DIR: elsewhere } },
    });

    expect(outcomes[0]?.file).toBe(join(elsewhere, "settings.json"));
    expect(
      JSON.parse(await readFile(join(elsewhere, "settings.json"), "utf8"))
    ).toEqual({ autoMode: { allow: ["$defaults", GLOBAL_TRUST_ENTRY] } });
  });

  it("reads nothing for an install without .claude/", async () => {
    // A file that would fail to parse proves it was never opened.
    await put("{ nope");
    const outcomes = await sync(true, [".cursor", ".opencode"]);

    expect(outcomes).toEqual([]);
    expect(await read()).toBe("{ nope");
  });
});

describe("rendering", () => {
  it("describes a missing entry as a global edit", async () => {
    const outcomes = await sync(false);
    expect(describeGlobalTrust(outcomes, home)).toEqual([
      {
        replace: false,
        what: "@taskless/cli at an exact version",
        where: "in ~/.claude/settings.json (autoMode.allow)",
      },
    ]);
  });

  it("warns with the file, key, and entry", async () => {
    const outcomes = await sync(false);
    const [warning] = globalTrustWarnings(
      outcomes,
      "npx @taskless/cli@1.2.3",
      home
    );

    expect(warning).toContain("~/.claude/settings.json");
    // `init` never asks; the bare invocation is what opens the wizard.
    expect(warning).toContain(
      "run `npx @taskless/cli@1.2.3` with no arguments in a terminal"
    );
    expect(warning).toContain("autoMode.allow");
    expect(warning).toContain(GLOBAL_TRUST_ENTRY);
  });

  it("describes a stale entry as a replacement, and warns that it is out of date", async () => {
    await put(JSON.stringify({ autoMode: { allow: ["Taskless CLI: old"] } }));
    const outcomes = await sync(false);

    expect(describeGlobalTrust(outcomes, home)).toEqual([
      expect.objectContaining({ replace: true }),
    ]);
    const [warning] = globalTrustWarnings(outcomes, "npx @taskless/cli", home);
    expect(warning).toContain("is out of date");
    expect(warning).toContain("which offers to replace it");
    expect(warning).toContain(GLOBAL_TRUST_ENTRY);
  });

  it("says how many strings carry the label when there are duplicates", async () => {
    await put(
      JSON.stringify({
        autoMode: { allow: [GLOBAL_TRUST_ENTRY, "Taskless CLI: pasted"] },
      })
    );
    const [warning] = globalTrustWarnings(
      await sync(false),
      "npx @taskless/cli",
      home
    );
    expect(warning).toContain("2 strings");
    expect(warning).toContain("folds them into one");
  });

  it("is silent once the entry is present", async () => {
    await sync(true);
    const outcomes = await sync(false);

    expect(describeGlobalTrust(outcomes, home)).toEqual([]);
    expect(globalTrustWarnings(outcomes, "npx @taskless/cli", home)).toEqual(
      []
    );
  });
});
