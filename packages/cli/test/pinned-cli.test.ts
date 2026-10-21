import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findCliPins,
  getPinnedCliNotice,
  type PinnedCli,
} from "../src/install/pinned-cli";

describe("findCliPins", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-pinned-cli-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function writePackage(contents: unknown): Promise<void> {
    await writeFile(join(cwd, "package.json"), JSON.stringify(contents));
  }

  async function writeAt(path: string, contents: unknown): Promise<void> {
    await mkdir(join(cwd, path), { recursive: true });
    await writeFile(join(cwd, path, "package.json"), JSON.stringify(contents));
  }

  async function writeFileAt(path: string, contents: string): Promise<void> {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await writeFile(join(cwd, path), contents);
  }

  /** The manifest of every stale pin, in report order. */
  async function manifestsOf(cliVersion: string): Promise<string[]> {
    const pins = await findCliPins(cwd, cliVersion);
    return pins.map((pin) => pin.manifest);
  }

  async function install(
    name: string,
    version: string,
    path = "."
  ): Promise<void> {
    const directory = join(cwd, path, "node_modules", ...name.split("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, version })
    );
  }

  it("finds nothing without a package.json", async () => {
    expect(await findCliPins(cwd, "0.11.2")).toEqual([]);
  });

  it("finds nothing in a package.json that is not JSON", async () => {
    // Advice on a successful install; the package manager reports this.
    await writeFile(join(cwd, "package.json"), "{ not json");
    expect(await findCliPins(cwd, "0.11.2")).toEqual([]);
  });

  describe("dependencies", () => {
    // The CLI runs through a launcher, so a dependency on it is raised
    // whatever it names: current, older, unbounded, either package.
    it.each(["0.11.2", "0.10.2", "^0.11.0", "latest", "workspace:*"])(
      "raises %s",
      async (spec) => {
        await writePackage({ devDependencies: { "@taskless/cli": spec } });
        expect(await findCliPins(cwd, "0.11.2")).toEqual([
          {
            manifest: "package.json",
            location: "devDependencies",
            name: "@taskless/cli",
            spec,
            installed: null,
            reason: "dependency",
          },
        ]);
      }
    );

    it("reads every dependency field and the nightly package name", async () => {
      await writePackage({
        dependencies: { "@taskless/cli": "0.9.0" },
        optionalDependencies: { "@taskless/cli-nightly": "0.10.0-2026x0" },
        peerDependencies: { "@taskless/cli": "0.9.0" },
      });
      const pins = await findCliPins(cwd, "0.11.2");
      expect(pins.map((pin) => [pin.location, pin.name, pin.reason])).toEqual([
        ["dependencies", "@taskless/cli", "dependency"],
        ["optionalDependencies", "@taskless/cli-nightly", "dependency"],
      ]);
    });

    it("raises a release dependency when a nightly is running", async () => {
      // A nightly leaves release pins alone, but a dependency is raised for
      // being a dependency, not for its channel.
      await writePackage({ devDependencies: { "@taskless/cli": "0.11.2" } });
      const pins = await findCliPins(cwd, "0.12.0-20261002181147x023048f");
      expect(pins.map((pin) => pin.reason)).toEqual(["dependency"]);
    });

    it("names the installed build, since that is what runs", async () => {
      await writePackage({ devDependencies: { "@taskless/cli": "^0.11.0" } });
      await install("@taskless/cli", "0.11.0");
      const [pin] = await findCliPins(cwd, "0.11.2");
      expect(pin?.installed).toBe("0.11.0");
    });
  });

  describe("a script version, against a running release", () => {
    it.each([
      ["0.10.2", true],
      ["=0.10.2", true],
      ["v0.11.1", true],
      ["0.10.2+build.5", true],
      ["0.11.2", false],
      ["0.12.0", false],
      // Pre-1.0 caret holds the minor, so `^0.10.2` never reaches 0.11.
      ["^0.10.2", true],
      ["^v0.10.2", true],
      ["^0.11.0", false],
      ["^0.0.3", true],
      ["~0.10.9", true],
      ["~0.11.0", false],
      // Unbounded: not reported, since a guess is a notice an agent learns to
      // skip.
      ["latest", false],
      ["*", false],
      [">=0.10.0", false],
    ])("%s is stale against 0.11.2: %s", async (spec, stale) => {
      await writePackage({
        scripts: { lint: `npx @taskless/cli@${spec} check` },
      });
      expect(await findCliPins(cwd, "0.11.2")).toEqual(
        stale
          ? [
              {
                manifest: "package.json",
                location: "scripts.lint",
                name: "@taskless/cli",
                spec,
                installed: null,
                reason: "stale",
              },
            ]
          : []
      );
    });
  });

  describe("nightly ordering", () => {
    // Two nightlies of one base sort by build time. Only a running nightly
    // judges a nightly pin by version: a running release raises every
    // nightly pin (see "channels").
    it.each([
      ["0.11.3-20260901000000xaaaaaaa", "0.11.3-20261005000000xbbbbbbb", true],
      ["0.11.3-20261005000000xbbbbbbb", "0.11.3-20261005000000xbbbbbbb", false],
      ["0.11.3-20261005000000xbbbbbbb", "0.11.3-20260901000000xaaaaaaa", false],
      ["0.11.3-20261005000000xbbbbbbb", "0.12.0-20260901000000xaaaaaaa", true],
      // Semver precedence, not string order: numeric identifiers compare by
      // value, so rc.9 predates rc.10, and a numeric identifier sorts below
      // an alphanumeric one.
      ["0.11.0-rc.9", "0.11.0-rc.10", true],
      ["0.11.0-rc.10", "0.11.0-rc.9", false],
      ["0.11.0-rc", "0.11.0-rc.1", true],
      ["0.11.0-1", "0.11.0-alpha", true],
    ])(
      "pin %s against running %s is stale: %s",
      async (pin, running, stale) => {
        await writePackage({
          scripts: { lint: `npx @taskless/cli-nightly@${pin} check` },
        });
        expect(await findCliPins(cwd, running)).toHaveLength(stale ? 1 : 0);
      }
    );

    it("judges a range by its ceiling, not by a prerelease of the next base", async () => {
      await writePackage({
        scripts: { lint: "npx @taskless/cli-nightly@^0.11.0 check" },
      });
      expect(
        await findCliPins(cwd, "0.12.0-20261002181147x023048f")
      ).toHaveLength(1);
    });
  });

  describe("channels", () => {
    // A nightly is installed alongside the release, so it never offers to
    // move the release's pins; a release is the move back, so it offers to
    // clean up every nightly pin.
    const nightly = "0.12.0-20261002181147x023048f";

    it("leaves a release script pin alone when a nightly is running, however old", async () => {
      await writePackage({
        scripts: { lint: "npx @taskless/cli@0.9.0 check" },
      });
      expect(await findCliPins(cwd, nightly)).toEqual([]);
    });

    it("still raises an older nightly script pin when a nightly is running", async () => {
      await writePackage({
        scripts: {
          lint: "npx @taskless/cli@0.11.2 check",
          try: "npx @taskless/cli-nightly@0.12.0-20260901000000xaaaaaaa check",
        },
      });
      const pins = await findCliPins(cwd, nightly);
      expect(pins.map((pin) => [pin.location, pin.reason])).toEqual([
        ["scripts.try", "stale"],
      ]);
    });

    it("raises a nightly script pin newer than the running release", async () => {
      await writePackage({
        scripts: { lint: `npx @taskless/cli-nightly@${nightly} check` },
      });
      const pins = await findCliPins(cwd, "0.11.2");
      expect(pins.map((pin) => pin.reason)).toEqual(["nightly"]);
    });

    it("raises a release script pin as unreleased after a nightly migrated the project", async () => {
      await writePackage({
        scripts: { lint: "npx @taskless/cli@0.11.2 check" },
      });
      const pins = await findCliPins(cwd, nightly, {
        migrated: { from: 8, to: 9 },
      });
      expect(pins.map((pin) => pin.reason)).toEqual(["unreleased"]);
    });

    it("does not treat a nightly's fresh install as a migration", async () => {
      await writePackage({
        scripts: { lint: "npx @taskless/cli@0.11.2 check" },
      });
      expect(
        await findCliPins(cwd, nightly, { migrated: { from: 0, to: 9 } })
      ).toEqual([]);
    });
  });

  it("finds a version spelled out in a script, and leaves @latest alone", async () => {
    await writePackage({
      scripts: {
        lint: "eslint . && npx @taskless/cli@0.10.2 check",
        nightly: "pnpm dlx @taskless/cli-nightly@0.10.0-2026x0 check",
        fresh: "npx @taskless/cli@latest check",
        bare: "taskless check",
        current: "npx @taskless/cli@0.11.2 check",
      },
    });
    expect(await findCliPins(cwd, "0.11.2")).toEqual([
      {
        manifest: "package.json",
        location: "scripts.lint",
        name: "@taskless/cli",
        spec: "0.10.2",
        installed: null,
        reason: "stale",
      },
      {
        manifest: "package.json",
        location: "scripts.nightly",
        name: "@taskless/cli-nightly",
        spec: "0.10.0-2026x0",
        installed: null,
        reason: "nightly",
      },
    ]);
  });

  it.each([
    ["npx @taskless/cli@0.10.2,check", "0.10.2"],
    ["npx @taskless/cli@0.10.2>out.txt", "0.10.2"],
    ["npx @taskless/cli@0.10.2:check", "0.10.2"],
    ["(npx @taskless/cli@0.10.2)", "0.10.2"],
  ])(
    "stops a script version at shell punctuation: %s",
    async (command, spec) => {
      await writePackage({ scripts: { lint: command } });
      const pins = await findCliPins(cwd, "0.11.2");
      expect(pins.map((pin) => pin.spec)).toEqual([spec]);
    }
  );

  it("does not match a longer name that ends in the package name", async () => {
    await writePackage({ scripts: { lint: "npx foo@taskless/cli@0.10.2" } });
    expect(await findCliPins(cwd, "0.11.2")).toEqual([]);
  });

  it("reports a pin repeated in one script once", async () => {
    await writePackage({
      scripts: {
        lint: "npx @taskless/cli@0.10.2 check && npx @taskless/cli@0.10.2 verify",
      },
    });
    expect(await findCliPins(cwd, "0.11.2")).toHaveLength(1);
  });

  describe("CI and hook files", () => {
    // The `ci` and `hooks` recipes once wrote `npx @taskless/cli@<version>`,
    // and the next upgrade leaves it behind.
    it("names a stale pin in a workflow by file and line", async () => {
      await writeFileAt(
        ".github/workflows/taskless.yml",
        "jobs:\n  check:\n    steps:\n      - run: npx @taskless/cli@0.11.0 check\n"
      );
      expect(await findCliPins(cwd, "0.12.0")).toEqual([
        {
          manifest: ".github/workflows/taskless.yml",
          location: "line 4",
          name: "@taskless/cli",
          spec: "0.11.0",
          installed: null,
          reason: "stale",
        },
      ]);
    });

    it("reads hook files, including a directory of hook scripts", async () => {
      await writeFileAt(
        ".husky/pre-commit",
        "npx @taskless/cli@0.11.0 check\n"
      );
      await writeFileAt(
        "lefthook.yml",
        "pre-commit:\n  commands:\n    taskless:\n      run: npx @taskless/cli-nightly@0.11.0-20260901000000xaaaaaaa check {staged_files}\n"
      );
      expect(await manifestsOf("0.12.0")).toEqual([
        ".husky/pre-commit",
        "lefthook.yml",
      ]);
    });

    it("leaves a current or floating pin alone", async () => {
      await writeFileAt(
        ".gitlab-ci.yml",
        "check:\n  script:\n    - npx @taskless/cli@0.12.0 check\n    - npx @taskless/cli@latest check\n"
      );
      expect(await findCliPins(cwd, "0.12.0")).toEqual([]);
    });

    it("reports a pin repeated in one file once, at its first line", async () => {
      await writeFileAt(
        ".github/workflows/ci.yml",
        "- run: npx @taskless/cli@0.11.0 check\n- run: npx @taskless/cli@0.11.0 report\n"
      );
      const pins = await findCliPins(cwd, "0.12.0");
      expect(pins.map((pin) => pin.location)).toEqual(["line 1"]);
    });

    it("comes after package.json pins", async () => {
      await writePackage({ devDependencies: { "@taskless/cli": "0.11.0" } });
      await writeFileAt(".gitlab-ci.yml", "- npx @taskless/cli@0.11.0 check\n");
      expect(await manifestsOf("0.12.0")).toEqual([
        "package.json",
        ".gitlab-ci.yml",
      ]);
    });

    it("judges a CI pin by channel, as a script pin is", async () => {
      // A nightly leaves the release's CI alone; a release cleans up the
      // nightly's.
      await writeFileAt(
        ".github/workflows/ci.yml",
        "- run: npx @taskless/cli@0.11.0 check\n- run: npx @taskless/cli-nightly@0.13.0-20261002181147x023048f check\n"
      );
      const underNightly = await findCliPins(
        cwd,
        "0.12.0-20261002181147x023048f"
      );
      expect(underNightly).toEqual([]);
      const underRelease = await findCliPins(cwd, "0.12.0");
      expect(underRelease.map((pin) => [pin.location, pin.reason])).toEqual([
        ["line 1", "stale"],
        ["line 2", "nightly"],
      ]);
    });
  });

  describe("workspace packages", () => {
    const stalePin = { devDependencies: { "@taskless/cli": "^0.10.2" } };

    it("reads the packages pnpm-workspace.yaml declares, naming the manifest", async () => {
      await writePackage({ name: "root" });
      await writeFile(
        join(cwd, "pnpm-workspace.yaml"),
        "packages:\n  - 'packages/*'\n"
      );
      await writeAt("packages/app", stalePin);
      await writeAt("packages/lib", { name: "lib" });
      expect(await findCliPins(cwd, "0.11.2")).toEqual([
        {
          manifest: "packages/app/package.json",
          location: "devDependencies",
          name: "@taskless/cli",
          spec: "^0.10.2",
          installed: null,
          reason: "dependency",
        },
      ]);
    });

    it.each([
      ["an array", ["apps/*"]],
      ["{ packages }", { packages: ["apps/*"] }],
    ])("reads the workspaces field as %s", async (_, workspaces) => {
      await writePackage({ workspaces });
      await writeAt("apps/web", stalePin);
      expect(await manifestsOf("0.11.2")).toEqual(["apps/web/package.json"]);
    });

    it("lists the root first, then workspace packages by path", async () => {
      await writePackage({ ...stalePin, workspaces: [".", "packages/*"] });
      await writeAt("packages/b", stalePin);
      await writeAt("packages/a", stalePin);
      expect(await manifestsOf("0.11.2")).toEqual([
        "package.json",
        "packages/a/package.json",
        "packages/b/package.json",
      ]);
    });

    it("drops what a negated pattern matches", async () => {
      await writePackage({
        workspaces: ["packages/*", "!packages/fixture"],
      });
      await writeAt("packages/app", stalePin);
      await writeAt("packages/fixture", stalePin);
      expect(await manifestsOf("0.11.2")).toEqual([
        "packages/app/package.json",
      ]);
    });

    it("follows ** without descending into node_modules", async () => {
      await writePackage({ workspaces: ["packages/**"] });
      await writeAt("packages/group/deep", stalePin);
      // An installed dependency is not a workspace package, whatever it pins.
      await writeAt("packages/group/deep/node_modules/dep", stalePin);
      expect(await manifestsOf("0.11.2")).toEqual([
        "packages/group/deep/package.json",
      ]);
    });

    it("skips a pattern that leaves the project", async () => {
      const inner = join(cwd, "inner");
      await writeAt("inner", { workspaces: ["../outside", "/abs/*"] });
      await writeAt("outside", stalePin);
      expect(await findCliPins(inner, "0.11.2")).toEqual([]);
    });

    it("reads the version the workspace package runs: its own link first, then the root's", async () => {
      await writePackage({ workspaces: ["packages/*"] });
      const caret = { devDependencies: { "@taskless/cli": "^0.11.0" } };
      await writeAt("packages/linked", caret);
      await writeAt("packages/hoisted", caret);
      // pnpm: the package's own link is what it runs, whatever the root has.
      await install("@taskless/cli", "0.11.0", "packages/linked");
      // npm/yarn hoisting: only the root has it.
      await install("@taskless/cli", "0.11.1");
      const pins = await findCliPins(cwd, "0.11.2");
      expect(pins.map((pin) => [pin.manifest, pin.installed])).toEqual([
        ["packages/hoisted/package.json", "0.11.1"],
        ["packages/linked/package.json", "0.11.0"],
      ]);
    });

    it("still reads pnpm-workspace.yaml when the root package.json is malformed", async () => {
      await writeFile(join(cwd, "package.json"), "{ not json");
      await writeFile(join(cwd, "pnpm-workspace.yaml"), "packages: [app]\n");
      await writeAt("app", stalePin);
      expect(await findCliPins(cwd, "0.11.2")).toHaveLength(1);
    });
  });
});

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g;
const plain = (value: string) => value.replaceAll(ANSI, "");

/**
 * The notice's text with the box taken off and the wrapping undone, so a
 * sentence the box broke across two rows can still be asserted on whole.
 */
function pinnedNotice(
  ...args: Parameters<typeof getPinnedCliNotice>
): string | undefined {
  const notice = getPinnedCliNotice(...args);
  if (notice === undefined) return undefined;
  return plain(notice)
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) => line.slice(1, -1).trim())
    .filter((line) => line !== "")
    .join(" ");
}

describe("getPinnedCliNotice", () => {
  const dependency: PinnedCli = {
    manifest: "package.json",
    location: "devDependencies",
    name: "@taskless/cli",
    spec: "^0.11.0",
    installed: "0.11.0",
    reason: "dependency",
  };
  const script: PinnedCli = {
    manifest: "packages/app/package.json",
    location: "scripts.lint",
    name: "@taskless/cli",
    spec: "0.10.2",
    installed: null,
    reason: "stale",
  };

  it("is absent when nothing is raised", () => {
    expect(getPinnedCliNotice([], "0.11.2")).toBeUndefined();
  });

  it("draws a box whose every row is the same width, around a long nightly pin", () => {
    // Coloured, so the width is measured on what a terminal shows rather than
    // on escape sequences.
    const level = chalk.level;
    chalk.level = 3;
    try {
      const notice = getPinnedCliNotice(
        [
          {
            ...script,
            manifest: "packages/some-long-workspace-name/package.json",
            name: "@taskless/cli-nightly",
            spec: "0.11.1-20260831132610x088fa7c",
          },
        ],
        "0.12.0-20261006162512x92b3715"
      ) as string;
      expect(notice).not.toBe(plain(notice));
      const rows = plain(notice)
        .split("\n")
        .filter((line) => line !== "");
      expect(rows[1]).toContain("TASKLESS CLI PINS");
      const widths = new Set(rows.map((line) => line.length));
      expect(widths, `rows: ${[...widths].join(", ")}`).toHaveLength(1);
      // Neither version is split across rows, so both can be copied.
      for (const version of [
        "0.11.1-20260831132610x088fa7c",
        "0.12.0-20261006162512x92b3715",
      ]) {
        expect(rows.some((line) => line.includes(version))).toBe(true);
      }
    } finally {
      chalk.level = level;
    }
  });

  it("names a CI pin by file and line", () => {
    const text = pinnedNotice(
      [
        {
          ...script,
          manifest: ".github/workflows/ci.yml",
          location: "line 12",
          spec: "0.11.0",
        },
      ],
      "0.12.0"
    );
    expect(text).toContain(
      ".github/workflows/ci.yml line 12: @taskless/cli 0.11.0 -> @taskless/cli@0.12.0"
    );
    expect(text).toContain("This project names the Taskless CLI");
  });

  it("asks for a reinstall only when a dependency is raised", () => {
    expect(pinnedNotice([dependency], "0.11.2")).toContain(
      "reinstall dependencies"
    );
    // A script, CI, or hook pin is a launcher line: nothing to reinstall.
    expect(pinnedNotice([script], "0.11.2")).not.toContain("reinstall");
    expect(
      pinnedNotice([script], "0.11.2", { migrated: { from: 5, to: 9 } })
    ).not.toContain("reinstall");
  });

  it("names every entry with what to do, and offers it rather than claiming it", () => {
    const notice = pinnedNotice([dependency, script], "0.11.2");
    expect(notice).toContain(
      "- package.json devDependencies: @taskless/cli ^0.11.0 (installed 0.11.0) -> remove the dependency"
    );
    expect(notice).toContain(
      "- packages/app/package.json scripts.lint: @taskless/cli 0.10.2 -> @taskless/cli@0.11.2"
    );
    expect(notice).toContain("Offer to remove it");
    expect(notice).toContain("Offer to update the older pins as shown");
  });

  it("points a removed dependency at the launcher", () => {
    const notice = pinnedNotice([dependency], "0.11.2");
    expect(notice).toContain("runs through the project launcher");
    expect(notice).toContain("node .taskless/bin/cli.mjs");
    // Nothing older to bump, and no migration: no breakage claim.
    expect(notice).not.toContain("will likely fail");
  });

  it("moves a nightly pin to the release package when a release is running", () => {
    // There is no @taskless/cli-nightly@0.11.2; nightlies always carry a stamp.
    const notice = pinnedNotice(
      [
        {
          ...script,
          name: "@taskless/cli-nightly",
          spec: "0.12.0-20261002181147x023048f",
          reason: "nightly",
        },
      ],
      "0.11.2"
    );
    expect(notice).toContain(
      "-> @taskless/cli@0.11.2, replacing @taskless/cli-nightly"
    );
    expect(notice).toContain("A nightly pin keeps");
    expect(notice).not.toContain("older than this project expects");
  });

  it("leaves a release pin as is after a nightly migration, and says why it matters", () => {
    const notice = pinnedNotice(
      [{ ...script, spec: "0.11.2", reason: "unreleased" }],
      "0.12.0-20261002181147x023048f",
      { migrated: { from: 8, to: 9 } }
    );
    expect(notice).toContain("-> leave as is");
    expect(notice).not.toContain("replacing");
    expect(notice).toContain("installs alongside the release");
    expect(notice).toContain("predates schema version 9");
    expect(notice).toContain("Tell the user before they commit .taskless/");
  });

  it("hedges without a migration: the layout the pin reads did not move", () => {
    const notice = pinnedNotice([script], "0.11.2");
    expect(notice).toContain("will likely fail");
    expect(notice).not.toContain("SCAFFOLD_VERSION_MISMATCH");
  });

  it("states the breakage as certain after a migration, and ties the change to the commit", () => {
    // A CLI refuses a scaffold newer than its own highest migration, so the
    // pin fails on CI's first run against the migrated files.
    const notice = pinnedNotice([dependency], "0.11.2", {
      migrated: { from: 5, to: 9 },
    });
    expect(notice).toContain("from schema version 5 to 9");
    expect(notice).toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(notice).toContain("break on the push");
    expect(notice).toContain("same commit as .taskless/");
    expect(notice).not.toContain("likely");
  });

  it("does not call a fresh install an upgrade", () => {
    // A fresh `init` creates `.taskless/` by migrating from schema 0.
    const notice = pinnedNotice([script], "0.11.2", {
      migrated: { from: 0, to: 9 },
    });
    expect(notice).not.toContain("upgrade");
    expect(notice).not.toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(notice).toContain("will likely fail");
  });
});
