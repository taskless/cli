import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AST_GREP_BINARY } from "../src/rules/scan";
import {
  pathCommandName,
  platformPackageName,
  resolvePlatformBinary,
  type PlatformBinarySpec,
} from "../src/rules/platform-binary";
import { VALE_BINARY } from "../src/rules/vale/binary";

/**
 * The two engines' packages are named differently, and the difference is not
 * cosmetic: ast-grep publishes a libc/toolchain suffix and Vale does not.
 * Sharing one resolver made that a parameter, and a parameter is exactly the
 * kind of thing a later refactor "simplifies" back into a single naming rule.
 *
 * These assert the naming for every platform the packages are published for,
 * because the failure they guard against is silent — a Vale lookup that appends
 * `-gnu` resolves nothing on Linux and reports the ordinary "Vale is
 * unavailable" message, so a naming bug is indistinguishable from a host that
 * never installed it.
 */

/** Run `body` as if the process were on `platform`/`arch`. */
function onPlatform<T>(platform: string, arch: string, body: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(
    process,
    "platform"
  ) as PropertyDescriptor;
  const originalArch = Object.getOwnPropertyDescriptor(
    process,
    "arch"
  ) as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "arch", { value: arch });
  try {
    return body();
  } finally {
    Object.defineProperty(process, "platform", originalPlatform);
    Object.defineProperty(process, "arch", originalArch);
  }
}

describe("platform package naming", () => {
  it("gives Vale no libc suffix on linux", () => {
    // The trap: `@taskless/vale-linux-x64-gnu` does not exist and never will.
    expect(
      onPlatform("linux", "x64", () => platformPackageName(VALE_BINARY))
    ).toBe("@taskless/vale-linux-x64");
    expect(
      onPlatform("linux", "arm64", () => platformPackageName(VALE_BINARY))
    ).toBe("@taskless/vale-linux-arm64");
  });

  it("gives Vale no toolchain suffix on win32", () => {
    expect(
      onPlatform("win32", "x64", () => platformPackageName(VALE_BINARY))
    ).toBe("@taskless/vale-win32-x64");
  });

  it("still appends ast-grep's gnu/msvc suffixes", () => {
    expect(
      onPlatform("linux", "x64", () => platformPackageName(AST_GREP_BINARY))
    ).toBe("@ast-grep/cli-linux-x64-gnu");
    expect(
      onPlatform("win32", "x64", () => platformPackageName(AST_GREP_BINARY))
    ).toBe("@ast-grep/cli-win32-x64-msvc");
  });

  it("appends no suffix for either engine on darwin", () => {
    expect(
      onPlatform("darwin", "arm64", () => platformPackageName(AST_GREP_BINARY))
    ).toBe("@ast-grep/cli-darwin-arm64");
    expect(
      onPlatform("darwin", "arm64", () => platformPackageName(VALE_BINARY))
    ).toBe("@taskless/vale-darwin-arm64");
  });

  it("names a package the CLI actually declares, for every Vale platform", () => {
    // Ties the naming rule to the pins in package.json rather than restating
    // it, so a rename on either side fails here instead of at runtime.
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { optionalDependencies: Record<string, string> };
    const declared = Object.keys(manifest.optionalDependencies).filter((name) =>
      name.startsWith("@taskless/vale-")
    );

    const generated = (
      [
        ["darwin", "arm64"],
        ["darwin", "x64"],
        ["linux", "arm64"],
        ["linux", "x64"],
        ["win32", "arm64"],
        ["win32", "x64"],
      ] as const
    ).map(([platform, arch]) =>
      onPlatform(platform, arch, () => platformPackageName(VALE_BINARY))
    );

    expect(generated.toSorted()).toEqual(declared.toSorted());
  });
});

/**
 * The order candidates are tried in, which no existing case pinned.
 *
 * Every other test here asserts that resolution succeeds or fails, and that is
 * exactly why extracting the shared resolver could silently reverse ast-grep's
 * `sg`-before-`ast-grep` ordering without a single failure: both names link to
 * the same target, so either answer is "resolved". These pin the ordering
 * itself, using a spec whose identity nothing on the host satisfies except the
 * fakes planted for the test.
 */
describe("candidate order", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  /** Two identically-behaving executables, differing only in name. */
  function plantOnPath(names: string[]): string {
    const directory = mkdtempSync(join(tmpdir(), "candidate-order-"));
    workspaces.push(directory);
    for (const name of names) {
      const path = join(directory, name);
      writeFileSync(path, "#!/bin/sh\necho 'fake-tool 1.0.0'\n");
      chmodSync(path, 0o755);
    }
    return directory;
  }

  const FAKE: PlatformBinarySpec = {
    label: "fake-tool",
    // Deliberately unresolvable, so the platform-package and node_modules/.bin
    // tiers miss and the PATH tier is what decides.
    packagePrefix: "@taskless/fake-tool-that-does-not-exist",
    toolchainSuffix: false,
    binaryNames: ["ast-grep", "sg"],
    identity: /fake-tool/i,
  };

  const onUnix = process.platform === "win32" ? it.skip : it;

  onUnix("tries the alternative name before the canonical one on PATH", () => {
    // ast-grep's original resolver looked for `sg` first at both link-based
    // tiers, with a comment marking it deliberate. Nothing observable rides on
    // it today — both names point at the same target and `isPlatformBinary`
    // verifies whichever answers — so only a test can keep the documented
    // ordering from being quietly reversed by a refactor.
    const directory = plantOnPath(["ast-grep", "sg"]);
    const originalPath = process.env.PATH;
    process.env.PATH = directory;
    try {
      expect(resolvePlatformBinary(FAKE).path).toBe(join(directory, "sg"));
    } finally {
      process.env.PATH = originalPath;
    }
  });

  onUnix("still resolves the canonical name when it is the only one", () => {
    const directory = plantOnPath(["ast-grep"]);
    const originalPath = process.env.PATH;
    process.env.PATH = directory;
    try {
      expect(resolvePlatformBinary(FAKE).path).toBe(
        join(directory, "ast-grep")
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("names each searched location once, however many spellings it tried", () => {
    // The platform package is probed under one name, and a tier searched under
    // two spellings is still one place to look; repeating a label makes
    // "Looked in: …" read as if we searched the same directory twice.
    const { tried } = resolvePlatformBinary(FAKE);
    expect(tried).toEqual([...new Set(tried)]);
    expect(tried).toEqual([
      platformPackageName(FAKE),
      "node_modules/.bin",
      "PATH",
    ]);
  });

  it("advises the PATH name the search actually looks for first", () => {
    // `sg`, not `ast-grep`, and `.exe`-suffixed on Windows — telling a Windows
    // user to install a name we would not find there is worse than silence.
    expect(pathCommandName(AST_GREP_BINARY)).toBe(
      process.platform === "win32" ? "sg.exe" : "sg"
    );
    expect(pathCommandName(VALE_BINARY)).toBe(
      process.platform === "win32" ? "vale.exe" : "vale"
    );
  });
});
