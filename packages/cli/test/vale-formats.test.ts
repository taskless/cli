import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VALE_FORMAT_TIERS } from "../src/rules/capabilities";
import { findValeBinary } from "../src/rules/vale/binary";
import {
  buildValeGlob,
  CONVERTER_DEPENDENT_EXTENSIONS,
  converterExclusionGlobs,
  converterFor,
  findConverterDependentFiles,
  skippedFilesNotice,
} from "../src/rules/vale/formats";
import { runVale } from "../src/rules/vale/run";

/**
 * The exclusion derived from the format tiers, and the run that uses it.
 *
 * WHAT VALE DOES WITH AN EXTENSION IS NOT ASSERTED HERE. `VALE_FORMAT_TIERS`
 * lives in `src/rules/capabilities.ts` and every row of it is re-measured
 * against the real binary in `vale-vendor-contract.test.ts` ("Vale engine
 * capabilities"), each tier by the discriminating property only that tier has.
 * This file asserts what our code does *given* those tiers, plus the end-to-end
 * behaviour of a run that contains a converter-dependent file. Two files
 * probing the same extension with different fixtures is how a weaker probe gets
 * to overrule a stronger one, so the probing happens in exactly one of them.
 */

const binary = findValeBinary().path;
const withVale = binary === undefined ? describe.skip : describe;

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

const existenceRule =
  "extends: existence\nmessage: \"Avoid 'simply'\"\nlevel: warning\ntokens:\n  - simply\n";

/**
 * A project whose single rule matches **every** file, which is the scoping that
 * makes the crash reachable: Vale only routes a file to a parser when the
 * configuration gives it a check to run, so a rule scoped `[*.md]` never asks
 * for `asciidoctor` in the first place.
 */
function makeProject(documents: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-formats-"));
  workspaces.push(cwd);
  mkdirSync(join(cwd, ".taskless", "rules", "vale", "no-simply"), {
    recursive: true,
  });
  writeFileSync(
    join(cwd, ".taskless", "rules", "vale", "no-simply", "no-simply.yml"),
    existenceRule
  );
  writeFileSync(
    join(cwd, ".taskless", ".vale.ini"),
    "StylesPath = rules/vale\nMinAlertLevel = suggestion\n\n[*]\nBasedOnStyles =\nno-simply.no-simply = YES\n"
  );
  for (const [path, body] of Object.entries(documents)) {
    const full = join(cwd, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return cwd;
}

describe("the format tier table", () => {
  it("derives the exclusion list from the tiers, with nothing hand-written", () => {
    // One place, so the merge with `capabilities.ts` is mechanical: adding a
    // measured entry to the table is the entire change, and no second list can
    // fall behind it.
    const expected = Object.entries(VALE_FORMAT_TIERS)
      .filter(([, tier]) => tier.startsWith("converter:"))
      .map(([extension]) => extension)
      .toSorted();
    expect(expected.length).toBeGreaterThan(0);
    expect([...CONVERTER_DEPENDENT_EXTENSIONS]).toEqual(expected);
    // Every excluded format names the program a user would install. A skip the
    // user cannot act on is only marginally better than a silent one.
    for (const extension of CONVERTER_DEPENDENT_EXTENSIONS) {
      expect(converterFor(`doc${extension}`)).toBeTruthy();
    }
  });

  it("covers all three AsciiDoc spellings", () => {
    // `.asc` was not in the bug report and crashes identically. It is here
    // because the tiers were measured rather than transcribed, and this case
    // is what stops the next transcription from dropping it again.
    for (const extension of [".adoc", ".asciidoc", ".asc"]) {
      expect(converterFor(`guide${extension}`)).toBe("asciidoctor");
    }
  });

  it("reads the extension case-insensitively", () => {
    // A case-insensitive filesystem hands Vale `README.RST` as
    // reStructuredText. Letting case decide would put the crash back on macOS
    // and Windows only.
    expect(converterFor("docs/README.RST")).toBe("rst2html");
  });

  it("treats an unmeasured extension as needing no converter", () => {
    // The safe path and the unknown path are the same path: Vale reads an
    // extension it does not recognize as plain text, which cannot shell out.
    expect(converterFor("script.py")).toBeUndefined();
    expect(converterFor("Makefile")).toBeUndefined();
    expect(converterFor("notes.md")).toBeUndefined();
  });

  it("hands over the formats measured as plaintext, converter-free", () => {
    // `.tex`, `.rmd`, `.mkd` and `.mkdn` all read as markup and are not — the
    // first table to be written by hand put `.tex` and `.rmd` in the native
    // tier. Being wrong about the tier is survivable; being wrong about needing
    // a converter is not, because it excludes a file Vale would have linted
    // perfectly well. This is that half of the claim.
    for (const extension of [".tex", ".rmd", ".mkd", ".mkdn", ".typ"]) {
      expect(converterFor(`doc${extension}`)).toBeUndefined();
    }
  });
});

describe("the exclusion glob", () => {
  it("anchors every pattern with **/ so nested files are excluded too", () => {
    // Vale matches a `--glob` against the basename when the pattern contains no
    // `/`, and against the path when it does. Combined with `.taskless/**` the
    // whole expression goes path-wise, and a bare `*.adoc` branch then stops
    // matching `docs/guide.adoc` — excluding the file you tested and not the
    // one in the next directory down.
    for (const pattern of converterExclusionGlobs()) {
      expect(pattern.startsWith("**/*.")).toBe(true);
    }
  });

  it("emits one negated alternation, because Vale honours only one --glob", () => {
    expect(buildValeGlob([".taskless/**", "**/*.adoc"])).toBe(
      "--glob=!{.taskless/**,**/*.adoc}"
    );
  });

  it("emits no flag when there is nothing to exclude", () => {
    expect(buildValeGlob([])).toBeUndefined();
  });
});

describe("the skipped-files notice", () => {
  it("is absent when nothing was skipped", () => {
    expect(skippedFilesNotice([])).toBeUndefined();
  });

  it("names the files, the converter, and that the rest was checked", () => {
    const notice = skippedFilesNotice(["docs/guide.adoc", "spec/api.rst"]);
    expect(notice).toContain("docs/guide.adoc");
    expect(notice).toContain("spec/api.rst");
    expect(notice).toContain("asciidoctor");
    expect(notice).toContain("rst2html");
    expect(notice).toContain("every other file was checked normally");
    // Vale supports these formats; this build cannot parse them. Telling a user
    // otherwise sends them to the wrong project's issue tracker.
    expect(notice).toContain("Vale supports these formats");
  });

  it("summarizes rather than printing an unbounded file list", () => {
    const files = Array.from({ length: 9 }, (_, index) => `d${index}.adoc`);
    const notice = skippedFilesNotice(files) ?? "";
    expect(notice).toContain("9 file(s)");
    expect(notice).toContain("and 4 more");
  });
});

describe("finding converter-dependent files", () => {
  it("finds them at the root and nested, and ignores everything else", async () => {
    const cwd = makeProject({
      "a.md": "simply\n",
      "d.adoc": "= T\n",
      "docs/deep/f.adoc": "= T\n",
      "docs/g.rst": "T\n",
      "node_modules/pkg/vendor.adoc": "= T\n",
    });
    expect(await findConverterDependentFiles(cwd, [])).toEqual([
      "d.adoc",
      "docs/deep/f.adoc",
      "docs/g.rst",
    ]);
  });

  it("answers an explicitly named file from its own name", async () => {
    const cwd = makeProject({ "a.md": "simply\n", "d.adoc": "= T\n" });
    expect(await findConverterDependentFiles(cwd, ["a.md", "d.adoc"])).toEqual([
      "d.adoc",
    ]);
  });
});

withVale(
  "runVale against the real binary, with converter-dependent files",
  () => {
    it("still reports every Markdown finding when an AsciiDoc file is present", async () => {
      // The bug, as one case. Vale aborts the whole process on the first `E100`
      // and writes nothing at all to stdout, so before the exclusion these three
      // findings did not arrive late or partially — they never existed.
      const cwd = makeProject({
        "a.md": "Just simply do it.\n",
        "b.md": "You can simply run it.\n",
        "c.md": "You simply go.\n",
        "d.adoc": "= Title\n\nJust simply do it.\n",
        "docs/nested.adoc": "= Title\n\nsimply\n",
      });

      const outcome = await runVale({
        cwd,
        configPath: join(".taskless", ".vale.ini"),
      });

      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.results.map((result) => result.file).toSorted()).toEqual([
        "a.md",
        "b.md",
        "c.md",
      ]);
    });

    it("says which files it skipped, rather than dropping them silently", async () => {
      // Silence is the bug. A run that quietly checks less than it was asked to
      // is indistinguishable from a clean one, which is exactly how the engine
      // got disabled without anyone noticing.
      const cwd = makeProject({
        "a.md": "Just simply do it.\n",
        "docs/nested.adoc": "= Title\n\nsimply\n",
      });

      const outcome = await runVale({
        cwd,
        configPath: join(".taskless", ".vale.ini"),
      });

      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.notice).toContain("docs/nested.adoc");
      expect(outcome.notice).toContain("asciidoctor");
    });

    it("declines a converter-dependent file even when named explicitly", async () => {
      // The one place we override an explicit request. Honouring it does not
      // check that file badly — it aborts the process, so the request would cost
      // the user the rest of their check.
      const cwd = makeProject({
        "a.md": "Just simply do it.\n",
        "d.adoc": "= Title\n\nsimply\n",
      });

      const outcome = await runVale({
        cwd,
        paths: ["a.md", "d.adoc"],
        configPath: join(".taskless", ".vale.ini"),
      });

      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.results.every((result) => result.file === "a.md")).toBe(
        true
      );
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(outcome.notice).toContain("d.adoc");
    });

    it("keeps out of .taskless/ while excluding converter formats", () => {
      // The two exclusions have to travel in one `--glob`, because Vale keeps
      // only the last one. This is the case that catches a future edit that adds
      // a second flag and silently drops the first.
      const cwd = makeProject({
        "a.md": "Just simply do it.\n",
        "d.adoc": "= Title\n\nsimply\n",
      });
      // The rule's own fixture directory: prose about the machinery, which a
      // whole-project run must not report as a user's finding.
      mkdirSync(
        join(cwd, ".taskless", "rules", "vale", "no-simply", ".tests", "fail"),
        { recursive: true }
      );
      writeFileSync(
        join(
          cwd,
          ".taskless",
          "rules",
          "vale",
          "no-simply",
          ".tests",
          "fail",
          "hedged.md"
        ),
        "Just simply do it.\n"
      );

      const result = spawnSync(
        binary as string,
        [
          "--config",
          join(".taskless", ".vale.ini"),
          "--output=JSON",
          "--no-exit",
          buildValeGlob([
            ".taskless/**",
            ...converterExclusionGlobs(),
          ]) as string,
          "--",
          ".",
        ],
        { cwd, encoding: "utf8" }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain(".taskless");
      expect(result.stdout).toContain("a.md");
    });
  }
);
