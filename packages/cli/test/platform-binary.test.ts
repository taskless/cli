import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AST_GREP_BINARY } from "../src/rules/scan";
import { platformPackageName } from "../src/rules/platform-binary";
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
