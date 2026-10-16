import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  describeGlobalTrust,
  GLOBAL_TRUST_ENTRY,
  globalTrustWarnings,
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

  it("treats a reworded entry as present and leaves the file alone", async () => {
    const original = JSON.stringify({
      autoMode: {
        allow: ["$defaults", "Taskless CLI: allowed with a pinned version"],
      },
    });
    await put(original);
    const outcomes = await sync(true);

    expect(outcomes[0]?.state).toBe("present");
    expect(await read()).toBe(original);
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
  it("describes a missing entry as an edit outside the project", async () => {
    const outcomes = await sync(false);
    const lines = describeGlobalTrust(outcomes, home).join("\n");

    expect(lines).toContain("~/.claude/settings.json");
    expect(lines).toContain("outside this project");
    expect(lines).toContain(`ALLOW: autoMode.allow += ${GLOBAL_TRUST_ENTRY}`);
  });

  it("warns with the file, key, and entry", async () => {
    const outcomes = await sync(false);
    const [warning] = globalTrustWarnings(outcomes, home);

    expect(warning).toContain("~/.claude/settings.json");
    expect(warning).toContain("autoMode.allow");
    expect(warning).toContain(GLOBAL_TRUST_ENTRY);
  });

  it("is silent once the entry is present", async () => {
    await sync(true);
    const outcomes = await sync(false);

    expect(describeGlobalTrust(outcomes, home)).toEqual([]);
    expect(globalTrustWarnings(outcomes, home)).toEqual([]);
  });
});
