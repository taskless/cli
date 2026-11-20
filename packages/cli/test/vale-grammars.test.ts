import { readdirSync } from "node:fs";
import { isAbsolute } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findValeGrammars,
  resolveValeGrammars,
  VALE_GRAMMARS,
} from "../src/rules/vale/grammars";
import { valeEnvironment } from "../src/rules/vale/run";

describe("resolveValeGrammars", () => {
  it("resolves the pinned grammar package's module directory", () => {
    const { path, tried } = resolveValeGrammars();
    expect(path).toBeDefined();
    expect(isAbsolute(path!)).toBe(true);
    expect(tried).toEqual([path]);
    expect(
      readdirSync(path!).filter((entry) => entry.endsWith(".wasm")).length
    ).toBeGreaterThan(0);
  });

  it("reports a missing package as a value, naming where it looked", () => {
    const result = resolveValeGrammars({
      ...VALE_GRAMMARS,
      packageName: "@taskless/vale-grammars-that-do-not-exist",
    });
    expect(result).toEqual({
      path: undefined,
      tried: ["@taskless/vale-grammars-that-do-not-exist/grammars"],
    });
  });

  it("rejects a directory that holds no grammar module", () => {
    // The package root exists but holds only metadata. Naming it to Vale
    // would behave like no grammars at all, with nothing saying why.
    const result = resolveValeGrammars({ ...VALE_GRAMMARS, directory: "." });
    expect(result.path).toBeUndefined();
    expect(result.tried).toHaveLength(1);
  });

  it("caches the resolution for the process", () => {
    expect(findValeGrammars()).toBe(findValeGrammars());
  });
});

describe("valeEnvironment", () => {
  it("names the pinned grammars, replacing a value from the user's shell", () => {
    // A VALE_GRAMMARS_PATH inherited from the shell would hand Vale grammars
    // the CLI did not ship or pin, so it never survives into the child.
    const previous = process.env.VALE_GRAMMARS_PATH;
    process.env.VALE_GRAMMARS_PATH = "/somewhere/else";
    try {
      expect(valeEnvironment("/pinned/grammars").VALE_GRAMMARS_PATH).toBe(
        "/pinned/grammars"
      );
      expect(valeEnvironment()).not.toHaveProperty("VALE_GRAMMARS_PATH");
    } finally {
      if (previous === undefined) delete process.env.VALE_GRAMMARS_PATH;
      else process.env.VALE_GRAMMARS_PATH = previous;
    }
  });
});
