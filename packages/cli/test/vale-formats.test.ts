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
  escapeGlobLiteral,
  findConverterDependentFiles,
  findOversizedFiles,
  skippedFilesNotice,
} from "../src/rules/vale/formats";
import { runVale, VALE_MAX_FILE_BYTES } from "../src/rules/vale/run";

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

  it("reads the extension case-sensitively, exactly as Vale routes it", () => {
    // Measured, not assumed: `doc.adoc` exits 2 with `E100 [lintAdoc]` while
    // `doc.ADOC` is read as plain text and exits 0 with findings — even when
    // the uppercase spelling names a lowercase file on a case-insensitive
    // filesystem, because Vale routes on the path string it was handed. This
    // function used to lowercase on the opposite assumption, which named a
    // file Vale had linted normally as one it never checked. The vendor
    // contract pins the binary's half of this.
    expect(converterFor("docs/README.rst")).toBe("rst2html");
    expect(converterFor("docs/README.RST")).toBeUndefined();
    expect(converterFor("guide.ADOC")).toBeUndefined();
    expect(converterFor("guide.AdOc")).toBeUndefined();
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
    for (const extension of [".tex", ".mkd", ".mkdn", ".pyi"]) {
      expect(converterFor(`doc${extension}`)).toBeUndefined();
    }
    // The other half, and the reason this list is re-derived rather than
    // remembered: `.typ` was plaintext until Vale 3.18.0 gave Typst a parser
    // that shells out, so the same extension that must NOT be excluded on one
    // version must be excluded on the next.
    expect(converterFor("doc.typ")).toBe("typst2vast");
    // `.mdx` went the other way in the same release — native now, so excluding
    // it would drop a file Vale reads perfectly well.
    expect(converterFor("doc.mdx")).toBeUndefined();
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

describe("escaping a literal path for buildValeGlob's alternation (taskless/cli#323 review)", () => {
  it("escapes every character the alternation would otherwise reinterpret", () => {
    // Mirrors GLOB_METACHARACTERS in git-ignored.ts exactly: the same nine
    // characters, escaped here instead of dropped, because dropping an
    // oversized file from ITS OWN exclusion defeats the guard for exactly the
    // pathological file it exists to protect.
    expect(escapeGlobLiteral("big,comma.md")).toBe(String.raw`big\,comma.md`);
    expect(escapeGlobLiteral("a{b}c.md")).toBe(String.raw`a\{b\}c.md`);
    expect(escapeGlobLiteral("weird[1].md")).toBe(String.raw`weird\[1\].md`);
    expect(escapeGlobLiteral("plain.md")).toBe("plain.md");
  });

  withVale("against the real binary", () => {
    it("actually excludes a file whose name contains a comma", () => {
      // Confirmed by hand while investigating this review: unescaped,
      // `--glob=!{big,comma.md}` splits into two patterns — "big" and
      // "comma.md" — neither of which matches the real file, so it is
      // NOT excluded. This is the guard against that regressing.
      const cwd = makeProject({
        "a.md": "Just simply do it.\n",
        "big,comma.md": "Just simply do it.\n",
      });

      const excluded = buildValeGlob([escapeGlobLiteral("big,comma.md")]);
      const result = spawnSync(
        binary as string,
        [
          "--config",
          join(".taskless", ".vale.ini"),
          "--output=JSON",
          "--no-exit",
          excluded as string,
          "--",
          ".",
        ],
        { cwd, encoding: "utf8" }
      );

      // MUTATION CHECK: pass `buildValeGlob(["big,comma.md"])` (unescaped)
      // instead and this fails — Vale's own JSON output then contains
      // "big,comma.md", because the comma split the alternation and
      // neither half matched the real file. Verified locally.
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("a.md");
      expect(result.stdout).not.toContain("big,comma.md");
    });
  });
});

describe("the skipped-files notice", () => {
  it("is absent when nothing was skipped", () => {
    expect(skippedFilesNotice([])).toBeUndefined();
  });

  it("names the files and says the format is unsupported, not that a tool is missing", () => {
    const notice =
      skippedFilesNotice(["docs/guide.adoc", "spec/api.rst"]) ?? "";
    expect(notice).toContain("docs/guide.adoc");
    expect(notice).toContain("spec/api.rst");
    expect(notice).toContain("every other file was checked normally");
    // The programs are still named — they are the REASON, and a user reading
    // "asciidoctor" understands what kind of gap this is.
    expect(notice).toContain("asciidoctor");
    expect(notice).toContain("rst2html");
    // But the notice must not read as an offer. We do not support any format
    // that needs an external program, so telling a user to install one promises
    // a path that is untested, and for `.xml` impossible — an XSLT stylesheet is
    // specific to the document. It would also make behaviour host-dependent:
    // macOS ships /usr/bin/xsltproc and Linux CI images do not, so the same
    // repository would check differently per machine.
    expect(notice).toContain("not supported by this build");
    expect(notice).not.toMatch(/install/i);
    expect(notice).not.toMatch(/\bPATH\b/);
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

  it("does not name an uppercase-extension file Vale lints normally", async () => {
    // Node's `glob` folds case with the filesystem, so on macOS the pattern
    // matches `docs/GUIDE.ADOC` — but Vale routes that to its plain-text
    // reader and lints it. Naming it in the notice would tell the user a file
    // was skipped that was checked, on one platform only. The walk defers to
    // `converterFor`, which is the only thing that models Vale's routing.
    const cwd = makeProject({
      "docs/GUIDE.ADOC": "= T\n",
      "docs/real.adoc": "= T\n",
    });
    expect(await findConverterDependentFiles(cwd, [])).toEqual([
      "docs/real.adoc",
    ]);
    expect(await findConverterDependentFiles(cwd, ["docs/GUIDE.ADOC"])).toEqual(
      []
    );
  });
});

// No Vale binary needed for these: `findOversizedFiles` on its own never
// spawns Vale — only `stat` and `glob`. `makeProject` (above) is overkill
// here, since it scaffolds a whole rule tree just to reach a hand-written
// `.vale.ini`; these tests only need a plain directory.
function makeScratchProject(documents: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-oversized-"));
  workspaces.push(cwd);
  for (const [path, body] of Object.entries(documents)) {
    const full = join(cwd, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return cwd;
}

describe("finding oversized files, scoped to what Vale would actually lint", () => {
  const oversizedBody = "x".repeat(VALE_MAX_FILE_BYTES + 1);

  it("reports an oversized file matching a section pattern", async () => {
    const cwd = makeScratchProject({ "README.md": oversizedBody });
    expect(
      await findOversizedFiles(cwd, [], VALE_MAX_FILE_BYTES, true, [
        "**/README.md",
      ])
    ).toEqual([{ file: "README.md", size: oversizedBody.length }]);
  });

  it("does not report an oversized file no section pattern reaches", async () => {
    // The taskless/cli#321 follow-up: `pnpm-lock.yaml` and
    // `packages/cli/CHANGELOG.md`, both over the limit in this repository,
    // are named by no rule's `[section]` — Vale was never going to open
    // either one, so reporting them is a false positive, not a caught
    // coverage hole. Reproduced in miniature: a lockfile-shaped file sits
    // alongside an in-scope README, and only the README is named.
    const cwd = makeScratchProject({
      "README.md": oversizedBody,
      "pnpm-lock.yaml": oversizedBody,
    });

    // MUTATION CHECK: replace the `sectionGlobs` branch's early loop with
    // the fallback `**/*` walk (or simply drop the `!wholeProject &&
    // !roots.some(...)` narrowing and the `wholeProject` check that selects
    // this branch) and this assertion fails — `pnpm-lock.yaml` starts
    // appearing alongside `README.md`. Verified locally: reverting restores
    // the single-entry result below.
    expect(
      await findOversizedFiles(cwd, [], VALE_MAX_FILE_BYTES, true, [
        "**/README.md",
      ])
    ).toEqual([{ file: "README.md", size: oversizedBody.length }]);
  });

  it("still checks a matching file that is not oversized", async () => {
    const cwd = makeScratchProject({ "README.md": "Just simply do it.\n" });
    expect(
      await findOversizedFiles(cwd, [], VALE_MAX_FILE_BYTES, true, [
        "**/README.md",
      ])
    ).toEqual([]);
  });

  it("still reports an oversized file when the caller passes paths: ['.'] (taskless/cli#323 review)", async () => {
    // `check .` — a near-default invocation — reaches `runVale` with
    // `paths = ["."]`, not `[]`: `filterExistingPaths` (`commands/check.ts`)
    // normalizes a bare `.` into that literal string rather than dropping
    // back to an empty array. Every OTHER test in this describe block uses
    // `paths: []`, which is why a `paths.length === 0` test for "whole
    // project" silently passed them all while being wrong for this one.
    //
    // `wholeProject` is the 4th argument precisely so the caller — `runVale`,
    // via `isWholeProjectWalk` — decides this, rather than this function
    // re-deriving a broken answer from `paths` on its own.
    const cwd = makeScratchProject({ "README.md": oversizedBody });

    // MUTATION CHECK: change the call below to pass `paths.length === 0`
    // (i.e. `false`, since `paths` here is `["."]`) instead of the literal
    // `true`, simulating the recomputed-internally bug this test exists to
    // catch, and the assertion fails — `README.md` is no longer reported,
    // because every glob match (`"README.md"`) fails `relative === "." ||
    // relative.startsWith("./")`. Verified locally; reverting restores green.
    expect(
      await findOversizedFiles(cwd, ["."], VALE_MAX_FILE_BYTES, true, [
        "**/README.md",
      ])
    ).toEqual([{ file: "README.md", size: oversizedBody.length }]);
  });

  it("falls back to the exhaustive walk when no sections are given", async () => {
    // The path a caller with no assembled config takes — `verifyValeRule`'s
    // isolating config, or a test that hands `runVale` a hand-written
    // `.vale.ini` directly. Unaffected by the scoping above: every file
    // under the target root is still a candidate, sections or not.
    const cwd = makeScratchProject({ "pnpm-lock.yaml": oversizedBody });
    expect(
      await findOversizedFiles(cwd, [], VALE_MAX_FILE_BYTES, true)
    ).toEqual([{ file: "pnpm-lock.yaml", size: oversizedBody.length }]);
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
