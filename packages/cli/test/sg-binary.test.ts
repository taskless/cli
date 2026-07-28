import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findSgBinary,
  isAstGrepBinary,
  resetSgBinaryCache,
} from "../src/rules/scan";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
};

/**
 * These cover the resolution contract, not ast-grep itself: the platform
 * package must win over anything on PATH, PATH must still be usable when no
 * platform package resolves, and an exhausted search must fail with a message
 * naming where it looked rather than deferring to a spawn error.
 */
describe("findSgBinary", () => {
  const originalPath = process.env.PATH;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    process.env.PATH = originalPath;
    resetSgBinaryCache();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A directory holding an executable named `command`. */
  function directoryWithExecutable(command: string): string {
    const directory = mkdtempSync(join(tmpdir(), "taskless-sg-"));
    temporaryDirectories.push(directory);
    const file = join(directory, command);
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
    return directory;
  }

  it("prefers the platform package over an unrelated binary on PATH", () => {
    const decoy = directoryWithExecutable("sg");
    process.env.PATH = decoy;

    const resolved = findSgBinary();

    // The platform package is an installed optionalDependency in this repo, so
    // it must win even when PATH offers something by the same name.
    expect(resolved).toContain("@ast-grep/cli-");
    expect(resolved).not.toContain(decoy);
  });

  it("resolves an absolute path, not a bare command name", () => {
    expect(findSgBinary()).toMatch(/^\//);
  });

  it("still resolves when PATH is empty", () => {
    process.env.PATH = "";
    expect(findSgBinary()).toContain("@ast-grep/cli-");
  });
});

/**
 * The check that makes the search trustworthy. The `@ast-grep/cli` wrapper's
 * postinstall leaves a placeholder *text file* at the binary's path when its
 * hardlink fails under pnpm dlx — so "the file exists" says nothing about
 * whether it will run. Every candidate is asked to identify itself instead.
 */
describe("isAstGrepBinary", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryFile(name: string, contents: string, mode: number): string {
    const directory = mkdtempSync(join(tmpdir(), "taskless-probe-"));
    temporaryDirectories.push(directory);
    const file = join(directory, name);
    writeFileSync(file, contents);
    chmodSync(file, mode);
    return file;
  }

  it("accepts the real ast-grep binary", () => {
    expect(isAstGrepBinary(findSgBinary())).toBe(true);
  });

  it("rejects a placeholder text file sitting where the binary belongs", () => {
    // This is the pnpm dlx failure mode verbatim: a readable file at the right
    // path that is not the binary. An existsSync check would accept it.
    const placeholder = temporaryFile("ast-grep", "placeholder\n", 0o644);
    expect(isAstGrepBinary(placeholder)).toBe(false);
  });

  it("rejects an executable that is not ast-grep", () => {
    const impostor = temporaryFile("sg", "#!/bin/sh\necho nope\n", 0o755);
    expect(isAstGrepBinary(impostor)).toBe(false);
  });

  it("rejects a path that does not exist", () => {
    expect(isAstGrepBinary(join(tmpdir(), "definitely-not-here-12345"))).toBe(
      false
    );
  });
});

/**
 * The wrapper used to hold the platform set in lockstep by pinning its own
 * optionalDependencies to its exact version. Declaring them directly moves that
 * obligation here, so it needs a check rather than a convention: a mixed set
 * would have different hosts running different ast-grep versions against the
 * same rules, which surfaces as inconsistent findings, not an install error.
 */
describe("ast-grep dependency declarations", () => {
  const optional = packageJson.optionalDependencies;
  const platformEntries = Object.entries(optional).filter(([name]) =>
    name.startsWith("@ast-grep/cli-")
  );

  it("declares at least one platform package", () => {
    expect(platformEntries.length).toBeGreaterThan(0);
  });

  it("pins every platform package to the same exact version", () => {
    const versions = new Set(platformEntries.map(([, version]) => version));
    expect(versions.size).toBe(1);

    const [version] = [...versions];
    // Exact, not a range: a caret would let hosts drift apart.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("does not ship the @ast-grep/cli wrapper to consumers", () => {
    const dependencies = packageJson.dependencies;
    expect(dependencies["@ast-grep/cli"]).toBeUndefined();
    expect(optional["@ast-grep/cli"]).toBeUndefined();
  });

  it("keeps the wrapper as a devDependency at the same version", () => {
    const development = packageJson.devDependencies;
    // fetch-ast-grep-schema reads this to pick the schema tag, so it must match
    // the binaries actually shipped.
    const [, platformVersion] = platformEntries[0]!;
    expect(development["@ast-grep/cli"]).toBe(platformVersion);
  });
});
