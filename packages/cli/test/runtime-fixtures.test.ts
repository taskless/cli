import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRuntimeFixtures } from "../src/rules/runtime/fixtures";
import { ENGINE_LAYOUTS } from "../src/rules/layout";

/**
 * Reading a runtime rule's fixture cases.
 *
 * The buckets are read independently and every entry must be a directory. Both
 * are load-bearing rather than tidy: a bucket that reads as empty when it is
 * unreadable makes a two-sided rule look one-sided, and a case silently skipped
 * is a fixture an author wrote that never ran and that nothing mentioned.
 */

const RULE = "no-eval";

async function caseDirectory(
  cwd: string,
  bucket: "pass" | "fail",
  name: string
): Promise<string> {
  const directory = join(
    cwd,
    ".taskless",
    "rules",
    "runtime",
    RULE,
    ".tests",
    bucket,
    name
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "sample.ts"), "const x = 1;\n", "utf8");
  return directory;
}

describe("reading runtime fixture cases", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-rt-fixtures-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads both buckets and reports the case directories as roots", async () => {
    const failRoot = await caseDirectory(cwd, "fail", "flags-it");
    const passRoot = await caseDirectory(cwd, "pass", "leaves-it");

    const { cases, coverage } = await readRuntimeFixtures(cwd, RULE);

    expect(coverage).toBe("both");
    // The root IS the case directory: that is what the harness is handed.
    expect(cases).toEqual(
      expect.arrayContaining([
        { bucket: "fail", name: "flags-it", root: failRoot },
        { bucket: "pass", name: "leaves-it", root: passRoot },
      ])
    );
  });

  it.each([
    ["both", ["fail", "pass"]],
    ["fail-only", ["fail"]],
    ["pass-only", ["pass"]],
    ["none", []],
  ] as const)("classifies coverage as %s", async (expected, buckets) => {
    for (const bucket of buckets) {
      await caseDirectory(cwd, bucket, "case-1");
    }

    const { coverage } = await readRuntimeFixtures(cwd, RULE);
    expect(coverage).toBe(expected);
  });

  it("treats a missing bucket as empty rather than as a failure", async () => {
    // Only `fail/` exists. A rule mid-authoring is not a broken read.
    await caseDirectory(cwd, "fail", "case-1");

    const { cases, coverage } = await readRuntimeFixtures(cwd, RULE);
    expect(coverage).toBe("fail-only");
    expect(cases).toHaveLength(1);
  });

  it("refuses a loose file, naming it, rather than skipping it", async () => {
    await caseDirectory(cwd, "fail", "case-1");
    await writeFile(
      join(cwd, ".taskless/rules/runtime", RULE, ".tests/fail/loose.ts"),
      "const x = 1;\n",
      "utf8"
    );

    // Skipping it would leave an author with a fixture that never ran and that
    // nothing mentioned, which is the failure this tier keeps producing.
    await expect(readRuntimeFixtures(cwd, RULE)).rejects.toThrow(/loose\.ts/);

    // This rejection IS the declared layout, and the conformance corpus
    // publishes that declaration as fact. The two are asserted together so a
    // reader changing either meets the other, rather than leaving the corpus
    // telling consumers a case is a directory while the reader accepts files.
    expect(ENGINE_LAYOUTS.runtime.fixtureLayout).toBe("case-directories");
  });

  it("does not read an unreadable bucket as an empty one", async () => {
    // The discrimination that matters. If this swallowed the permission error,
    // the rule below would report `fail-only` — a one-sided rule — when in
    // truth its pass side was simply unreadable.
    await caseDirectory(cwd, "fail", "case-1");
    const passBucket = join(
      cwd,
      ".taskless/rules/runtime",
      RULE,
      ".tests/pass"
    );
    await mkdir(passBucket, { recursive: true });
    await chmod(passBucket, 0o000);

    try {
      await expect(readRuntimeFixtures(cwd, RULE)).rejects.toThrow();
    } finally {
      // Restore before cleanup, or `rm` cannot remove it either.
      await chmod(passBucket, 0o755);
    }
  });
});
