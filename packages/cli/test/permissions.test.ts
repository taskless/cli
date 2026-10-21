import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commandOfRule,
  describePermissionEdits,
  syncPermissions,
  type SyncPermissionsOptions,
} from "../src/install/permissions";

const V1 = "npx @taskless/cli@0.13.0";
const V2 = "npx @taskless/cli@0.13.1";
const N1 = "npx @taskless/cli-nightly@0.13.2-20261016000000xaaaaaaa";
const N2 = "npx @taskless/cli-nightly@0.13.2-20261017000000xbbbbbbb";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-permissions-"));
  await mkdir(join(cwd, ".taskless"), { recursive: true });
  await writeFile(
    join(cwd, ".taskless", "taskless.json"),
    JSON.stringify({ version: 2, install: {} })
  );
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function put(path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(cwd, path)), { recursive: true });
  await writeFile(join(cwd, path), contents);
}

async function text(path: string): Promise<string> {
  return readFile(join(cwd, path), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(join(cwd, path));
    return true;
  } catch {
    return false;
  }
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await text(path)) as unknown;
}

function sync(
  options: Partial<SyncPermissionsOptions> & { selected: string[] }
): ReturnType<typeof syncPermissions> {
  return syncPermissions(cwd, {
    codex: false,
    invocation: V1,
    write: true,
    ...options,
  });
}

describe("Claude Code", () => {
  it("adds a word-bounded rule and keeps everything else", async () => {
    await put(
      ".claude/settings.json",
      '{\n    "permissions": {\n        "allow": ["Bash(git status)"]\n    },\n    "model": "opus"\n}\n'
    );
    const edits = await sync({ selected: [".claude"] });

    expect(edits).toEqual([
      {
        file: ".claude/settings.json",
        created: false,
        allowed: [`Bash(${V1} *)`],
        removed: [],
        skipped: null,
      },
    ]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: ["Bash(git status)", `Bash(${V1} *)`] },
      model: "opus",
    });
  });

  // The space before `*` is the word boundary: `@0.13.0 *` requires a space
  // after the version, so `@0.13.01` does not match.
  it("never writes a rule that could match a longer version", async () => {
    await sync({ selected: [".claude"] });
    const [rule] = (
      (await json(".claude/settings.json")) as {
        permissions: { allow: string[] };
      }
    ).permissions.allow;
    expect(rule).toBe(`Bash(${V1} *)`);
    expect(rule).not.toMatch(/@0\.13\.0\*/);
  });

  it("leaves a file that denies the command alone", async () => {
    const original = '{ "permissions": { "deny": ["Bash(npx *)"] } }\n';
    await put(".claude/settings.json", original);
    const edits = await sync({ selected: [".claude"] });

    expect(edits[0]?.skipped).toBe("denies this command");
    expect(await text(".claude/settings.json")).toBe(original);
  });

  it("leaves a file that does not parse alone", async () => {
    await put(".claude/settings.json", "{ not json");
    const edits = await sync({ selected: [".claude"] });

    expect(edits[0]?.skipped).toMatch(/does not parse/);
    expect(await text(".claude/settings.json")).toBe("{ not json");
  });
});

describe("upgrades", () => {
  it("swaps the recorded rule for the new version", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    const edits = await sync({ selected: [".claude"], invocation: V2 });

    expect(edits[0]).toMatchObject({
      allowed: [`Bash(${V2} *)`],
      removed: [`Bash(${V1} *)`],
    });
    // Created by Taskless and holding only its rule, so it stays as a file
    // with the new rule rather than being deleted mid-swap.
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V2} *)`] },
    });
    const manifest = (await json(".taskless/taskless.json")) as {
      install: { permissions: Record<string, { rules: string[] }> };
    };
    expect(
      manifest.install.permissions[".claude/settings.json"]?.rules
    ).toEqual([`Bash(${V2} *)`]);
  });

  it("replaces a Taskless rule it did not record", async () => {
    // Added by hand, or by an agent through the skill's fallback: either way
    // it pins a version that is no longer installed.
    await put(
      ".claude/settings.json",
      JSON.stringify({
        permissions: { allow: ["Bash(npx @taskless/cli@0.12.0 *)"] },
      })
    );
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits[0]).toMatchObject({
      allowed: [`Bash(${V1} *)`],
      removed: ["Bash(npx @taskless/cli@0.12.0 *)"],
    });
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`] },
    });
  });

  it("replaces the colon form the skill used to propose", async () => {
    const stale =
      "Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23:*)";
    await put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { allow: [stale] } })
    );
    const edits = await sync({ selected: [".claude"], invocation: N1 });

    expect(edits[0]?.removed).toEqual([stale]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${N1} *)`] },
    });
  });

  it("removes an unversioned Taskless rule too", async () => {
    await put(
      ".claude/settings.json",
      JSON.stringify({
        permissions: { allow: ["Bash(pnpm dlx @taskless/cli *)"] },
      })
    );
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits[0]?.removed).toEqual(["Bash(pnpm dlx @taskless/cli *)"]);
  });

  it("leaves deny rules and other packages alone", async () => {
    const others = [
      "Bash(npx prettier *)",
      "Bash(npx @taskless/cli-foo@1.0.0 *)",
      "Bash(npx -y @taskless/cli@0.12.0 *)",
    ];
    await put(
      ".claude/settings.json",
      JSON.stringify({
        permissions: {
          allow: others,
          deny: ["Bash(npx @taskless/cli@0.11.0 *)"],
        },
      })
    );
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits[0]?.removed).toEqual([]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: {
        allow: [...others, `Bash(${V1} *)`],
        deny: ["Bash(npx @taskless/cli@0.11.0 *)"],
      },
    });
  });

  it("is a no-op once the file holds only the current rule", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits).toEqual([]);
  });

  it("leaves an unrecorded file alone for a harness it does not install", async () => {
    const contents = JSON.stringify({
      permissions: { allow: ["Bash(npx @taskless/cli@0.12.0 *)"] },
    });
    await put(".claude/settings.json", contents);
    await sync({ selected: [".cursor"], invocation: V1 });

    expect(await text(".claude/settings.json")).toBe(contents);
  });

  it("removes only its own line from a multi-line list", async () => {
    await put(
      ".claude/settings.json",
      '{\n  "permissions": {\n    "allow": [\n      "Bash(git status)", // mine\n      "Bash(ls *)"\n    ]\n  }\n}\n'
    );
    await sync({ selected: [".claude"], invocation: V1 });
    await sync({ selected: [".claude"], invocation: V2 });

    expect(await text(".claude/settings.json")).toBe(
      `{\n  "permissions": {\n    "allow": [\n      "Bash(git status)", // mine\n      "Bash(ls *)",\n      "Bash(${V2} *)"\n    ]\n  }\n}\n`
    );
  });

  it("deletes a file Taskless created once it holds nothing else", async () => {
    await sync({ selected: [".cursor"] });
    expect(await exists(".cursor/permissions.json")).toBe(true);

    const edits = await sync({ selected: [] });

    expect(edits.map((edit) => edit.removed.length > 0)).toEqual([true, true]);
    expect(await exists(".cursor/permissions.json")).toBe(false);
    expect(await exists(".cursor/cli.json")).toBe(false);
  });

  it("never deletes a file that existed before", async () => {
    await put(".claude/settings.json", "{}\n");
    await sync({ selected: [".claude"] });
    await sync({ selected: [] });

    expect(await exists(".claude/settings.json")).toBe(true);
  });
});

describe("the release and the nightly side by side", () => {
  it("installs a nightly beside the release's rules", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    const edits = await sync({ selected: [".claude"], invocation: N1 });

    expect(edits[0]).toMatchObject({
      allowed: [`Bash(${N1} *)`],
      removed: [],
    });
    expect(await sync({ selected: [".claude"], invocation: N1 })).toEqual([]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${N1} *)`] },
    });
  });

  it("removes the nightly's rules on a release install", async () => {
    // Installing the release is the move back to mainline.
    await sync({ selected: [".claude"], invocation: V1 });
    await sync({ selected: [".claude"], invocation: N1 });
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits[0]).toMatchObject({
      allowed: [],
      removed: [`Bash(${N1} *)`],
    });
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`] },
    });
  });

  it("upgrades only its own package's rule", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    await sync({ selected: [".claude"], invocation: N1 });
    const edits = await sync({ selected: [".claude"], invocation: N2 });

    expect(edits[0]).toMatchObject({
      allowed: [`Bash(${N2} *)`],
      removed: [`Bash(${N1} *)`],
    });
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${N2} *)`] },
    });
  });

  it("leaves an unrecorded release rule alone on a nightly install", async () => {
    const release = "Bash(npx @taskless/cli@0.12.0:*)";
    await put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { allow: [release] } })
    );
    const edits = await sync({ selected: [".claude"], invocation: N1 });

    expect(edits[0]?.removed).toEqual([]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [release, `Bash(${N1} *)`] },
    });
  });

  it("removes an unrecorded nightly rule on a release install", async () => {
    const nightly =
      "Bash(npx @taskless/cli-nightly@0.13.0-20261015220659xbf27a23:*)";
    await put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { allow: [nightly] } })
    );
    const edits = await sync({ selected: [".claude"], invocation: V1 });

    expect(edits[0]?.removed).toEqual([nightly]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`] },
    });
  });

  it("keeps the release's record, so a created file is still deleted", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    await sync({ selected: [".claude"], invocation: N1 });

    await sync({ selected: [], invocation: N1 });
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`] },
    });

    await sync({ selected: [], invocation: V1 });
    expect(await exists(".claude/settings.json")).toBe(false);
  });

  it("removes no package rules for an invocation that names neither", async () => {
    await sync({ selected: [".claude"], invocation: V1 });
    await sync({ selected: [".claude"], invocation: N1 });
    const edits = await sync({
      selected: [".claude"],
      invocation: "node ./packages/cli/dist/index.js",
    });

    expect(edits[0]?.removed).toEqual([]);
  });

  // The scoping lives in `syncPermissions()`, but each harness finds and
  // edits its own format, and Codex rewrites its whole file.
  it.each([
    {
      harness: "Cursor",
      selected: [".cursor"],
      files: [".cursor/permissions.json", ".cursor/cli.json"],
    },
    {
      harness: "OpenCode, object form",
      selected: [".opencode"],
      files: [".opencode/opencode.json"],
    },
    {
      harness: "OpenCode, array form",
      selected: [".opencode"],
      files: ["opencode.json"],
      seed: '{ "permissions": [] }\n',
    },
    {
      harness: "Codex",
      selected: [".agents"],
      codex: true,
      files: [".codex/rules/taskless.rules"],
    },
  ])(
    "installs a nightly beside the release, and a release removes it, in $harness",
    async ({ selected, codex = false, files, seed }) => {
      if (seed !== undefined) await put(files[0] ?? "", seed);
      const run = (invocation: string) => sync({ selected, codex, invocation });
      await run(V1);
      await run(N1);
      await run(N2);

      expect(await run(N2)).toEqual([]);
      for (const file of files) {
        const contents = await text(file);
        expect(contents).toContain("@taskless/cli@0.13.0");
        expect(contents).toContain("0.13.2-20261017000000xbbbbbbb");
        expect(contents).not.toContain("0.13.2-20261016000000xaaaaaaa");
      }

      await run(V1);
      for (const file of files) {
        const contents = await text(file);
        expect(contents).toContain("@taskless/cli@0.13.0");
        expect(contents).not.toContain("cli-nightly");
      }
    }
  );
});

describe("Cursor", () => {
  it("writes the editor allowlist and the CLI rules", async () => {
    await sync({ selected: [".cursor"] });

    expect(await json(".cursor/permissions.json")).toEqual({
      terminalAllowlist: [V1],
    });
    expect(await json(".cursor/cli.json")).toEqual({
      permissions: {
        allow: [
          "Shell(npx:@taskless/cli@0.13.0)",
          "Shell(npx:@taskless/cli@0.13.0 *)",
        ],
      },
    });
  });

  it("respects a CLI deny on the command base", async () => {
    const original = '{ "permissions": { "deny": ["Shell(npx)"] } }\n';
    await put(".cursor/cli.json", original);
    const edits = await sync({ selected: [".cursor"] });

    expect(
      edits.find((edit) => edit.file === ".cursor/cli.json")?.skipped
    ).toBe("denies this command");
    expect(await text(".cursor/cli.json")).toBe(original);
  });
});

describe("Cursor replacing a stale rule", () => {
  it("replaces stale editor and CLI rules, leaving other entries", async () => {
    await put(
      ".cursor/permissions.json",
      JSON.stringify({
        terminalAllowlist: [
          "npx @taskless/cli@0.12.0",
          "npx @taskless/cli-foo",
        ],
      })
    );
    await put(
      ".cursor/cli.json",
      JSON.stringify({
        permissions: {
          allow: [
            "Shell(npx:@taskless/cli@0.12.0)",
            "Shell(npx:@taskless/cli@0.12.0 *)",
            "Shell(git)",
          ],
        },
      })
    );
    const edits = await sync({ selected: [".cursor"] });

    expect(edits.map((edit) => edit.removed)).toEqual([
      ["Shell(npx:@taskless/cli@0.12.0)", "Shell(npx:@taskless/cli@0.12.0 *)"],
      ["npx @taskless/cli@0.12.0"],
    ]);
    expect(await json(".cursor/permissions.json")).toEqual({
      terminalAllowlist: ["npx @taskless/cli-foo", V1],
    });
    expect(await json(".cursor/cli.json")).toEqual({
      permissions: {
        allow: [
          "Shell(git)",
          "Shell(npx:@taskless/cli@0.13.0)",
          "Shell(npx:@taskless/cli@0.13.0 *)",
        ],
      },
    });
  });
});

describe("OpenCode", () => {
  // The object form applies the LAST matching rule.
  it("puts the rule after a catch-all in the object form, keeping comments", async () => {
    await put(
      ".opencode/opencode.jsonc",
      '{\n  // mine\n  "permission": {\n    "bash": {\n      "*": "ask" // ask by default\n    }\n  }\n}\n'
    );
    await sync({ selected: [".opencode"] });

    expect(await text(".opencode/opencode.jsonc")).toBe(
      `{\n  // mine\n  "permission": {\n    "bash": {\n      "*": "ask", // ask by default\n      "${V1} *": "allow"\n    }\n  }\n}\n`
    );
  });

  // The array form is read top to bottom.
  it("puts the rule first in the array form", async () => {
    await put(
      "opencode.json",
      '{\n  "permissions": [\n    { "action": "shell", "resource": "rm *", "effect": "ask" }\n  ]\n}\n'
    );
    await sync({ selected: [".opencode"] });

    expect(await json("opencode.json")).toEqual({
      permissions: [
        { action: "shell", resource: `${V1} *`, effect: "allow" },
        { action: "shell", resource: "rm *", effect: "ask" },
      ],
    });
  });

  // Appended last, our allow would override this deny, so it is not written.
  it("leaves an object-form deny that covers the command alone", async () => {
    const original = '{ "permission": { "bash": { "npx *": "deny" } } }\n';
    await put("opencode.json", original);
    const edits = await sync({ selected: [".opencode"] });

    expect(edits[0]?.skipped).toBe("denies this command");
    expect(await text("opencode.json")).toBe(original);
  });

  it("creates .opencode/opencode.json when the project has none", async () => {
    await sync({ selected: [".opencode"] });

    expect(await json(".opencode/opencode.json")).toEqual({
      permission: { bash: { [`${V1} *`]: "allow" } },
    });
  });
});

describe("OpenCode replacing a stale rule", () => {
  it("replaces a stale object-form rule but keeps a Taskless deny", async () => {
    await put(
      "opencode.json",
      JSON.stringify({
        permission: {
          bash: {
            "npx @taskless/cli@0.12.0 *": "allow",
            "npx @taskless/cli@0.11.0 *": "deny",
          },
        },
      })
    );
    const edits = await sync({ selected: [".opencode"] });

    // The deny on 0.11.0 does not cover 0.13.0, so the rule is still written.
    expect(edits[0]?.removed).toEqual(["npx @taskless/cli@0.12.0 *"]);
    expect(await json("opencode.json")).toEqual({
      permission: {
        bash: {
          "npx @taskless/cli@0.11.0 *": "deny",
          [`${V1} *`]: "allow",
        },
      },
    });
  });

  it("replaces a stale array-form rule", async () => {
    await put(
      "opencode.json",
      JSON.stringify({
        permissions: [
          {
            action: "shell",
            resource: "npx @taskless/cli@0.12.0 *",
            effect: "allow",
          },
          { action: "shell", resource: "rm *", effect: "ask" },
        ],
      })
    );
    const edits = await sync({ selected: [".opencode"] });

    expect(edits[0]?.removed).toEqual(["npx @taskless/cli@0.12.0 *"]);
    expect(await json("opencode.json")).toEqual({
      permissions: [
        { action: "shell", resource: `${V1} *`, effect: "allow" },
        { action: "shell", resource: "rm *", effect: "ask" },
      ],
    });
  });
});

describe("Codex", () => {
  it("writes its own rules file when Codex is chosen", async () => {
    // No `.codex/` in the project: checking the Codex row is enough.
    await sync({ selected: [".agents"], codex: true });

    expect(await text(".codex/rules/taskless.rules")).toContain(
      'prefix_rule(pattern = ["npx","@taskless/cli@0.13.0"], decision = "allow")'
    );
  });

  it("writes nothing for .agents/ without Codex", async () => {
    expect(await sync({ selected: [".agents"] })).toEqual([]);
    expect(await exists(".codex")).toBe(false);
  });

  it("replaces a stale rule in a file Taskless headed but did not record", async () => {
    await put(
      ".codex/rules/taskless.rules",
      "# Written by Taskless: allows exactly the installed Taskless CLI.\n" +
        'prefix_rule(pattern = ["npx","@taskless/cli@0.12.0"], decision = "allow")\n'
    );
    const edits = await sync({ selected: [".agents"], codex: true });

    expect(edits[0]?.removed).toEqual([
      'prefix_rule(pattern = ["npx","@taskless/cli@0.12.0"], decision = "allow")',
    ]);
    const rules = await text(".codex/rules/taskless.rules");
    expect(rules).toContain("@taskless/cli@0.13.0");
    expect(rules).not.toContain("@taskless/cli@0.12.0");
  });

  it("recognises its own file by the mark even when the header is reworded", async () => {
    await put(
      ".codex/rules/taskless.rules",
      "# Written by Taskless, in some older wording.\n" +
        'prefix_rule(pattern = ["npx","@taskless/cli@0.12.0"], decision = "allow")\n'
    );
    const edits = await sync({ selected: [".agents"], codex: true });

    expect(edits[0]?.skipped).toBeNull();
    expect(await text(".codex/rules/taskless.rules")).not.toContain("0.12.0");
  });

  it("leaves a rules file at its path that Taskless did not write", async () => {
    await put(".codex/rules/taskless.rules", "# theirs\n");
    const edits = await sync({ selected: [".agents"], codex: true });

    expect(edits[0]?.skipped).toMatch(/not written by Taskless/);
    expect(await text(".codex/rules/taskless.rules")).toBe("# theirs\n");
  });
});

describe("scope", () => {
  it("writes nothing for a harness that is not an install target", async () => {
    await mkdir(join(cwd, ".devin"), { recursive: true });
    expect(await sync({ selected: [".agents"] })).toEqual([]);
    expect(await exists(".devin/config.json")).toBe(false);
  });

  it("reports without writing in a dry run", async () => {
    const edits = await sync({ selected: [".claude"], write: false });

    expect(edits[0]?.allowed).toEqual([`Bash(${V1} *)`]);
    expect(await exists(".claude/settings.json")).toBe(false);
    const manifest = (await json(".taskless/taskless.json")) as {
      install: Record<string, unknown>;
    };
    expect(manifest.install.permissions).toBeUndefined();
  });
});

describe("describePermissionEdits", () => {
  it("labels every edit so it reads without colour", () => {
    const level = chalk.level;
    chalk.level = 0;
    try {
      expect(
        describePermissionEdits([
          {
            file: ".claude/settings.json",
            created: false,
            allowed: [`Bash(${V2} *)`],
            removed: [`Bash(${V1} *)`],
            skipped: null,
          },
          {
            file: ".cursor/cli.json",
            created: false,
            allowed: [],
            removed: [],
            skipped: "denies this command",
          },
        ])
      ).toEqual([
        "Edited .claude/settings.json",
        `  ALLOW: Bash(${V2} *)`,
        `  REMOVE: Bash(${V1} *)`,
        "SKIPPED: .cursor/cli.json denies this command",
      ]);
    } finally {
      chalk.level = level;
    }
  });

  it("colours ALLOW green", () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      const [, allow] = describePermissionEdits([
        {
          file: ".claude/settings.json",
          created: true,
          allowed: [`Bash(${V1} *)`],
          removed: [],
          skipped: null,
        },
      ]);
      expect(allow).toBe(`  ${chalk.green(`ALLOW: Bash(${V1} *)`)}`);
      expect(allow).toContain("\u001B[32m");
    } finally {
      chalk.level = level;
    }
  });

  it("leaves REMOVE uncoloured and colours SKIPPED red", () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      const [, remove, skipped] = describePermissionEdits([
        {
          file: ".claude/settings.json",
          created: false,
          allowed: [],
          removed: [`Bash(${V1} *)`],
          skipped: null,
        },
        {
          file: ".cursor/cli.json",
          created: false,
          allowed: [],
          removed: [],
          skipped: "denies this command",
        },
      ]);
      expect(remove).toBe(`  REMOVE: Bash(${V1} *)`);
      expect(skipped).toBe(
        chalk.red("SKIPPED: .cursor/cli.json denies this command")
      );
    } finally {
      chalk.level = level;
    }
  });
});

describe("commandOfRule", () => {
  it("reads every harness's spelling as the command it allows", () => {
    expect(commandOfRule(`Bash(${V1} *)`)).toBe(V1);
    expect(commandOfRule(`Bash(${V1}:*)`)).toBe(V1);
    expect(commandOfRule("Shell(npx:@taskless/cli@0.13.0 *)")).toBe(V1);
    expect(commandOfRule(`${V1} *`)).toBe(V1);
    expect(commandOfRule(V1)).toBe(V1);
    expect(
      commandOfRule(
        'prefix_rule(pattern = ["npx","@taskless/cli@0.13.0"], decision = "allow")'
      )
    ).toBe(V1);
  });
});

describe("launcher rules", () => {
  const RL = "./.taskless/bin/cli.mjs";
  const NL = "./.taskless/bin/cli-nightly.mjs";

  it("allows the launcher beside the invocation in Claude Code", async () => {
    const edits = await sync({ selected: [".claude"], launcher: RL });
    expect(edits[0]?.allowed).toEqual([`Bash(${V1} *)`, `Bash(${RL} *)`]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${RL} *)`] },
    });
  });

  it("writes each harness's launcher form", async () => {
    await sync({
      selected: [".cursor", ".opencode", ".agents"],
      codex: true,
      launcher: RL,
    });
    expect(await json(".cursor/permissions.json")).toEqual({
      terminalAllowlist: [V1, RL],
    });
    expect(
      (await json(".cursor/cli.json")) as { permissions: { allow: string[] } }
    ).toEqual({
      permissions: {
        allow: [
          "Shell(npx:@taskless/cli@0.13.0)",
          "Shell(npx:@taskless/cli@0.13.0 *)",
          `Shell(${RL})`,
        ],
      },
    });
    expect(await json(".opencode/opencode.json")).toEqual({
      permission: { bash: { [`${V1} *`]: "allow", [`${RL} *`]: "allow" } },
    });
    expect(await text(".codex/rules/taskless.rules")).toContain(
      `prefix_rule(pattern = ["${RL}"], decision = "allow")`
    );
  });

  it("is not an edit on an upgrade", async () => {
    await sync({ selected: [".claude"], launcher: RL });
    const edits = await sync({
      selected: [".claude"],
      invocation: V2,
      launcher: RL,
    });
    expect(edits).toEqual([
      {
        file: ".claude/settings.json",
        created: false,
        allowed: [`Bash(${V2} *)`],
        removed: [`Bash(${V1} *)`],
        skipped: null,
      },
    ]);
  });

  it("keeps the other package's launcher rule", async () => {
    await sync({ selected: [".claude"], launcher: RL });
    await sync({ selected: [".claude"], invocation: N1, launcher: NL });
    expect(await json(".claude/settings.json")).toEqual({
      permissions: {
        allow: [
          `Bash(${V1} *)`,
          `Bash(${RL} *)`,
          `Bash(${N1} *)`,
          `Bash(${NL} *)`,
        ],
      },
    });
  });

  it("removes the launcher rule with its package when the harness is deselected", async () => {
    await sync({ selected: [".claude"], launcher: RL });
    await sync({ selected: [".claude"], invocation: N1, launcher: NL });
    const edits = await sync({ selected: [], invocation: N1, launcher: NL });
    expect(edits[0]?.removed).toEqual([`Bash(${N1} *)`, `Bash(${NL} *)`]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${RL} *)`] },
    });
  });

  it("removes the nightly's launcher rule on a release install", async () => {
    await sync({ selected: [".claude"], launcher: RL });
    await sync({ selected: [".claude"], invocation: N1, launcher: NL });
    const edits = await sync({ selected: [".claude"], launcher: RL });
    expect(edits[0]?.removed).toEqual([`Bash(${N1} *)`, `Bash(${NL} *)`]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${RL} *)`] },
    });
  });

  it("replaces a hand-added colon form of its launcher", async () => {
    await put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { allow: [`Bash(${RL}:*)`] } })
    );
    const edits = await sync({ selected: [".claude"], launcher: RL });
    expect(edits[0]?.removed).toEqual([`Bash(${RL}:*)`]);
    expect(await json(".claude/settings.json")).toEqual({
      permissions: { allow: [`Bash(${V1} *)`, `Bash(${RL} *)`] },
    });
  });

  it("leaves a file that denies the launcher alone", async () => {
    await put(
      ".claude/settings.json",
      JSON.stringify({ permissions: { deny: [`Bash(${RL} *)`] } })
    );
    const edits = await sync({ selected: [".claude"], launcher: RL });
    expect(edits[0]?.skipped).toBe("denies this command");
  });

  it("reads a launcher rule as the command it allows", () => {
    expect(commandOfRule(`Shell(${RL})`)).toBe(RL);
    expect(commandOfRule(`Bash(${RL} *)`)).toBe(RL);
  });
});
