import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findStalePins,
  getPinnedCliNotice,
  type PinnedCli,
} from "../src/install/pinned-cli";

describe("findStalePins", () => {
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

  /** The manifest of every stale pin, in report order. */
  async function manifestsOf(cliVersion: string): Promise<string[]> {
    const pins = await findStalePins(cwd, cliVersion);
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
    expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
  });

  it("finds nothing in a package.json that is not JSON", async () => {
    // Advice on a successful install; the package manager reports this.
    await writeFile(join(cwd, "package.json"), "{ not json");
    expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
  });

  describe("a dependency range, with nothing installed", () => {
    it.each([
      ["0.10.2", true],
      ["=0.10.2", true],
      ["= 0.10.2", true],
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
      // Unbounded or unknowable: not reported, since a guess is a notice an
      // agent learns to skip.
      ["latest", false],
      ["*", false],
      [">=0.10.0", false],
      ["workspace:*", false],
      ["github:taskless/cli", false],
    ])("%s is stale against 0.11.2: %s", async (spec, stale) => {
      await writePackage({ devDependencies: { "@taskless/cli": spec } });
      expect(await findStalePins(cwd, "0.11.2")).toEqual(
        stale
          ? [
              {
                manifest: "package.json",
                location: "devDependencies",
                name: "@taskless/cli",
                spec,
                installed: null,
              },
            ]
          : []
      );
    });
  });

  describe("nightly ordering", () => {
    // A nightly is stamped with the release it anticipates, so it sorts
    // before that release, and two nightlies of one base by build time.
    it.each([
      ["0.11.3-20260901000000xaaaaaaa", "0.11.3-20261005000000xbbbbbbb", true],
      ["0.11.3-20261005000000xbbbbbbb", "0.11.3-20261005000000xbbbbbbb", false],
      ["0.11.3-20261005000000xbbbbbbb", "0.11.3-20260901000000xaaaaaaa", false],
      ["0.12.0-20261002181147x023048f", "0.12.0", true],
      ["0.12.0-20261002181147x023048f", "0.11.2", false],
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
          devDependencies: { "@taskless/cli-nightly": pin },
        });
        expect(await findStalePins(cwd, running)).toHaveLength(stale ? 1 : 0);
      }
    );

    it("judges a range by its ceiling, not by a prerelease of the next base", async () => {
      await writePackage({ devDependencies: { "@taskless/cli": "^0.11.0" } });
      expect(
        await findStalePins(cwd, "0.12.0-20261002181147x023048f")
      ).toHaveLength(1);
    });
  });

  describe("the installed version", () => {
    it("reports a range that admits the running version when the installed build is older", async () => {
      // `pnpm add -D` writes `^0.11.0` and locks 0.11.0, which is what CI
      // runs. The range alone would say nothing.
      await writePackage({ devDependencies: { "@taskless/cli": "^0.11.0" } });
      await install("@taskless/cli", "0.11.0");
      expect(await findStalePins(cwd, "0.11.2")).toEqual([
        {
          manifest: "package.json",
          location: "devDependencies",
          name: "@taskless/cli",
          spec: "^0.11.0",
          installed: "0.11.0",
        },
      ]);
    });

    it("is quiet when the installed build is current and the range can reach it", async () => {
      await writePackage({ devDependencies: { "@taskless/cli": "^0.11.0" } });
      await install("@taskless/cli", "0.11.2");
      expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
    });

    it("still reports a range that cannot reach the running version, whatever is installed", async () => {
      // The next fresh install resolves the range, not what happens to be
      // in node_modules today.
      await writePackage({ devDependencies: { "@taskless/cli": "^0.10.0" } });
      await install("@taskless/cli", "0.11.2");
      expect(await findStalePins(cwd, "0.11.2")).toEqual([
        {
          manifest: "package.json",
          location: "devDependencies",
          name: "@taskless/cli",
          spec: "^0.10.0",
          installed: "0.11.2",
        },
      ]);
    });

    it("reads an older installed nightly of the same base", async () => {
      await writePackage({
        devDependencies: { "@taskless/cli-nightly": "^0.12.0-0" },
      });
      await install("@taskless/cli-nightly", "0.12.0-20260901000000xaaaaaaa");
      expect(
        await findStalePins(cwd, "0.12.0-20261005000000xbbbbbbb")
      ).toHaveLength(1);
    });
  });

  it("reads every dependency field and the nightly package name", async () => {
    await writePackage({
      dependencies: { "@taskless/cli": "0.9.0" },
      optionalDependencies: { "@taskless/cli-nightly": "0.10.0-2026x0" },
      peerDependencies: { "@taskless/cli": "0.9.0" },
    });
    expect(await findStalePins(cwd, "0.11.2")).toEqual([
      {
        manifest: "package.json",
        location: "dependencies",
        name: "@taskless/cli",
        spec: "0.9.0",
        installed: null,
      },
      {
        manifest: "package.json",
        location: "optionalDependencies",
        name: "@taskless/cli-nightly",
        spec: "0.10.0-2026x0",
        installed: null,
      },
    ]);
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
    expect(await findStalePins(cwd, "0.11.2")).toEqual([
      {
        manifest: "package.json",
        location: "scripts.lint",
        name: "@taskless/cli",
        spec: "0.10.2",
        installed: null,
      },
      {
        manifest: "package.json",
        location: "scripts.nightly",
        name: "@taskless/cli-nightly",
        spec: "0.10.0-2026x0",
        installed: null,
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
      expect(await findStalePins(cwd, "0.11.2")).toEqual([
        {
          manifest: "package.json",
          location: "scripts.lint",
          name: "@taskless/cli",
          spec,
          installed: null,
        },
      ]);
    }
  );

  it("does not match a longer name that ends in the package name", async () => {
    await writePackage({ scripts: { lint: "npx foo@taskless/cli@0.10.2" } });
    expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
  });

  it("reports a pin repeated in one script once", async () => {
    await writePackage({
      scripts: {
        lint: "npx @taskless/cli@0.10.2 check && npx @taskless/cli@0.10.2 verify",
      },
    });
    expect(await findStalePins(cwd, "0.11.2")).toHaveLength(1);
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
      expect(await findStalePins(cwd, "0.11.2")).toEqual([
        {
          manifest: "packages/app/package.json",
          location: "devDependencies",
          name: "@taskless/cli",
          spec: "^0.10.2",
          installed: null,
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
      expect(await findStalePins(inner, "0.11.2")).toEqual([]);
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
      const pins = await findStalePins(cwd, "0.11.2");
      expect(pins.map((pin) => [pin.manifest, pin.installed])).toEqual([
        ["packages/hoisted/package.json", "0.11.1"],
        ["packages/linked/package.json", "0.11.0"],
      ]);
    });

    it("is quiet when a workspace package's own link is current", async () => {
      await writePackage({ workspaces: ["packages/*"] });
      await writeAt("packages/app", {
        devDependencies: { "@taskless/cli": "^0.11.0" },
      });
      await install("@taskless/cli", "0.11.2", "packages/app");
      await install("@taskless/cli", "0.11.0");
      expect(await findStalePins(cwd, "0.11.2")).toEqual([]);
    });

    it("still reads pnpm-workspace.yaml when the root package.json is malformed", async () => {
      await writeFile(join(cwd, "package.json"), "{ not json");
      await writeFile(join(cwd, "pnpm-workspace.yaml"), "packages: [app]\n");
      await writeAt("app", stalePin);
      expect(await findStalePins(cwd, "0.11.2")).toHaveLength(1);
    });
  });
});

describe("getPinnedCliNotice", () => {
  const releasePin: PinnedCli = {
    manifest: "package.json",
    location: "devDependencies",
    name: "@taskless/cli",
    spec: "0.10.2",
    installed: null,
  };

  it("is absent when nothing is stale", () => {
    expect(getPinnedCliNotice([], "0.11.2")).toBeUndefined();
  });

  it("names every pin with its target, and offers the bump rather than claiming it", () => {
    const notice = getPinnedCliNotice(
      [
        { ...releasePin, spec: "^0.11.0", installed: "0.11.0" },
        {
          ...releasePin,
          manifest: "packages/app/package.json",
          location: "scripts.lint",
        },
      ],
      "0.11.2"
    );
    expect(notice).toContain(
      "  - package.json devDependencies: @taskless/cli ^0.11.0 (installed 0.11.0) -> @taskless/cli@0.11.2"
    );
    expect(notice).toContain(
      "  - packages/app/package.json scripts.lint: @taskless/cli 0.10.2 -> @taskless/cli@0.11.2"
    );
    expect(notice).toContain("Offer to update them as shown");
  });

  it("moves a nightly pin to the release package when a release is running", () => {
    // There is no @taskless/cli-nightly@0.11.2; nightlies always carry a stamp.
    const notice = getPinnedCliNotice(
      [{ ...releasePin, name: "@taskless/cli-nightly", spec: "0.11.2-2026x0" }],
      "0.11.2"
    );
    expect(notice).toContain(
      "-> @taskless/cli@0.11.2, replacing @taskless/cli-nightly"
    );
  });

  it("moves a release pin to the nightly package when a nightly is running", () => {
    const notice = getPinnedCliNotice(
      [releasePin],
      "0.12.0-20261002181147x023048f"
    );
    expect(notice).toContain(
      "-> @taskless/cli-nightly@0.12.0-20261002181147x023048f, replacing @taskless/cli"
    );
  });

  it("hedges without a migration: the layout the pin reads did not move", () => {
    const notice = getPinnedCliNotice([releasePin], "0.11.2");
    expect(notice).toContain("will likely fail");
    expect(notice).not.toContain("SCAFFOLD_VERSION_MISMATCH");
  });

  it("states the breakage as certain after a migration, and ties the bump to the commit", () => {
    // A CLI refuses a scaffold newer than its own highest migration, so the
    // pin fails on CI's first run against the migrated files.
    const notice = getPinnedCliNotice([releasePin], "0.11.2", {
      migrated: { from: 5, to: 9 },
    });
    expect(notice).toContain("from schema version 5 to 9");
    expect(notice).toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(notice).toContain("will break");
    expect(notice).toContain("same commit as .taskless/");
    expect(notice).not.toContain("likely");
  });

  it("does not call a fresh install an upgrade", () => {
    // A fresh `init` creates `.taskless/` by migrating from schema 0.
    const notice = getPinnedCliNotice([releasePin], "0.11.2", {
      migrated: { from: 0, to: 9 },
    });
    expect(notice).not.toContain("upgrade");
    expect(notice).not.toContain("SCAFFOLD_VERSION_MISMATCH");
    expect(notice).toContain("will likely fail");
  });
});
