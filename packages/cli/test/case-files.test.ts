import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { caseResult, readCaseFiles } from "../src/rules/fixtures";

/**
 * The files a failing case carries in `verify --json`.
 *
 * The integration suites only ever see small text fixtures, so the two
 * exclusions (size and "not text") are pinned here directly: a regression in
 * either would otherwise pass silently.
 */

const LIMIT = 64 * 1024;

let cwd: string;
let root: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "taskless-case-files-"));
  root = join(cwd, ".taskless", "rules", "demo", "tests", "fail", "case");
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("readCaseFiles", () => {
  it("keeps a file at exactly the size limit and drops one a byte over", async () => {
    await writeFile(join(root, "at-limit.txt"), "a".repeat(LIMIT));
    await writeFile(join(root, "over-limit.txt"), "a".repeat(LIMIT + 1));

    const files = await readCaseFiles(cwd, root);

    expect(files.map((file) => file.path)).toEqual([
      ".taskless/rules/demo/tests/fail/case/at-limit.txt",
    ]);
  });

  it("drops a file holding a NUL byte", async () => {
    await writeFile(join(root, "nul.bin"), Buffer.from("text\0more"));
    await writeFile(join(root, "kept.ts"), "const a = 1;\n");

    const files = await readCaseFiles(cwd, root);

    expect(files).toEqual([
      {
        path: ".taskless/rules/demo/tests/fail/case/kept.ts",
        content: "const a = 1;\n",
      },
    ]);
  });

  it("drops a file that is not valid UTF-8 rather than decoding it lossily", async () => {
    await writeFile(
      join(root, "latin1.txt"),
      Buffer.from([0x63, 0x61, 0xff, 0x65])
    );

    expect(await readCaseFiles(cwd, root)).toEqual([]);
  });

  it("returns a file's content byte for byte, BOM included", async () => {
    await writeFile(join(root, "bom.ts"), "﻿const é = 1;\n");

    const files = await readCaseFiles(cwd, root);

    expect(files[0]?.content).toBe("﻿const é = 1;\n");
  });
});

function fixture() {
  return { bucket: "fail" as const, name: "case", root };
}

describe("caseResult", () => {
  it("attaches files only to a failing case", async () => {
    await writeFile(join(root, "a.ts"), "x\n");

    // eslint-disable-next-line unicorn/no-useless-undefined -- the verdict is a required parameter, and undefined is what "passed" means
    const passing = await caseResult(cwd, fixture(), undefined);
    const failing = await caseResult(cwd, fixture(), "fail/case: no finding");

    expect(passing).toEqual({ name: "fail/case", expected: "fail", ok: true });
    expect(failing).toEqual({
      name: "fail/case",
      expected: "fail",
      ok: false,
      message: "fail/case: no finding",
      files: [
        { path: ".taskless/rules/demo/tests/fail/case/a.ts", content: "x\n" },
      ],
    });
  });
});
