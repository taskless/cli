import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { runVale, VALE_MAX_FILE_BYTES } from "../src/rules/vale/run";

/**
 * These run the real Vale binary. It ships as an `optionalDependency` for the
 * host platform, so it is present on every platform we publish for — including
 * CI — and absent only on an unsupported arch. Skipping there is the honest
 * option: a stub would be asserting our own mock's behaviour, and the whole
 * point of these cases is what Vale actually does with a config.
 */
const valeAvailable = findValeBinary().path !== undefined;
const withVale = valeAvailable ? describe : describe.skip;

const workspaces: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/** A project with a rule directory per rule, plus a run config to invoke. */
function makeProject(
  config: string,
  rules: Record<string, string>,
  documents: Record<string, string>
): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-run-"));
  workspaces.push(cwd);
  // `runVale` reads the *assembled* config, which assembly writes here. These
  // tests exercise the runner, so they write it directly rather than going
  // through assembly.
  mkdirSync(join(cwd, ".taskless"), { recursive: true });
  writeFileSync(join(cwd, ".taskless", ".vale.ini"), config);
  for (const [name, body] of Object.entries(rules)) {
    mkdirSync(join(cwd, ".taskless", "rules", "vale", name), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".taskless", "rules", "vale", name, `${name}.yml`),
      body
    );
  }
  for (const [path, body] of Object.entries(documents)) {
    const full = join(cwd, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return cwd;
}

const existenceRule = (token: string, message: string) =>
  `extends: existence\nmessage: "${message}"\nlevel: warning\ntokens:\n  - ${token}\n`;

/** StylesPath is relative to the config file, so `.` is `.taskless/vale/`. */
const header = "StylesPath = rules/vale\nMinAlertLevel = suggestion\n";

describe("runVale when the binary is missing", () => {
  it("reports the engine unavailable instead of throwing", async () => {
    // D6b: a missing Vale must not abort the run. The message has to name
    // where we looked, or the user has nothing to act on.
    const binary = await import("../src/rules/vale/binary");
    vi.spyOn(binary, "findValeBinary").mockReturnValue({
      path: undefined,
      source: undefined,
      tried: ["@taskless/vale-darwin-arm64", "node_modules/.bin", "PATH"],
    });

    const outcome = await runVale({ cwd: process.cwd() });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.message).toContain("Vale binary not found");
    expect(outcome.message).toContain("PATH");
  });
});

withVale("runVale against the real binary", () => {
  it("maps a finding to a CheckResult", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "One\nTwo\nJust simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    if (result === undefined) throw new Error("expected a finding");
    expect(result).toMatchObject({
      source: "vale",
      // `rules.` stripped: the prefix is Vale's StylesPath artifact.
      ruleId: "no-simply",
      severity: "warning",
      message: "Avoid 'simply'",
      file: "doc.md",
      matchedText: "simply",
    });
    // The match is on the document's third line; `range` is 0-indexed, so 2.
    expect(result.range.start.line).toBe(2);
    expect(result.range.end.line).toBe(2);
  });

  it("produces no findings, and no error, on a clean document", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Nothing objectionable here.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    // Vale prints nothing at all when it finds nothing; that must read as an
    // empty result rather than as unparseable output.
    expect(outcome).toEqual({ status: "ok", blocking: false, results: [] });
  });

  it("normalizes suggestion to hint", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nsoft.soft = YES\n`,
      {
        soft: `extends: existence\nmessage: "Consider rewording"\nlevel: suggestion\ntokens:\n  - perhaps\n`,
      },
      { "doc.md": "It is perhaps fine.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results[0]?.severity).toBe("hint");
  });

  describe("committed-config scoping", () => {
    const rules = {
      "no-simply": existenceRule("simply", "Avoid 'simply'"),
      "no-very": existenceRule("very", "Avoid 'very'"),
    };
    const documents = {
      "marketing/a.md": "Just simply do it.\n",
      "marketing/legacy/b.md": "Just simply do it.\n",
      "api/c.md": "Just simply do it.\n",
    };

    it("scopes a rule to the paths its matcher includes", async () => {
      const cwd = makeProject(
        `${header}\n[marketing/**]\nno-simply.no-simply = YES\n`,
        rules,
        documents
      );
      const outcome = await runVale({
        cwd,
        paths: ["marketing", "api"],
      });
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      const files = outcome.results.map((result) => result.file);
      expect(files).toContain("marketing/a.md");
      expect(files).not.toContain("api/c.md");
    });

    it("lets a later matcher override an earlier one", async () => {
      // Order is significant, and this asserts only the working order. The
      // opposite order is pinned in vale-vendor-contract.test.ts, where it
      // documents that a disable does NOT win on its own — the earlier name of
      // this test claimed "regardless of order" while testing one order, which
      // would have kept passing while the claim was false.
      const cwd = makeProject(
        `${header}\n[marketing/**]\nno-simply.no-simply = YES\n\n[marketing/legacy/**]\nno-simply.no-simply = NO\n`,
        rules,
        documents
      );
      const outcome = await runVale({ cwd, paths: ["marketing"] });
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      const files = outcome.results.map((result) => result.file);
      expect(files).toContain("marketing/a.md");
      expect(files).not.toContain("marketing/legacy/b.md");
    });

    it("merges duplicate matchers rather than letting the last one win", async () => {
      // Two `[*.md]` sections each enabling a different rule. Vale unions
      // them, so a document matching the glob runs both.
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n\n[*.md]\nno-very.no-very = YES\n`,
        rules,
        { "doc.md": "Just simply do it, very quickly.\n" }
      );
      const outcome = await runVale({ cwd, paths: ["doc.md"] });
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.results.map((result) => result.ruleId).toSorted()).toEqual(
        ["no-simply", "no-very"]
      );
    });
  });

  it("reports a malformed rule as a failure instead of crashing", async () => {
    // Measured, not assumed: Vale answers a bad rule on stderr with exit 2 and
    // an empty stdout, so the non-zero-exit branch reports it. The point of the
    // test is that a broken rule file surfaces as a failure the user can act on
    // rather than as "no Vale findings", which is indistinguishable from a
    // clean run and is how a silently disabled engine ships.
    const cwd = makeProject(
      `${header}\n[*.md]\nbogus.bogus = YES\n`,
      {
        bogus: `extends: existence\nmessage: "test"\nlevel: catastrophe\ntokens:\n  - simply\n`,
      },
      { "doc.md": "Just simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    // Vale's own diagnostic is carried through verbatim: the rule file it
    // rejected and why.
    expect(outcome.message).toContain("E201");
    expect(outcome.message).toContain("bogus.yml");
  });

  it("carries Vale's zero-exit stderr as a notice", async () => {
    // A section-less config: `rules.no-simply = YES` sits above the first
    // `[…]` line, so Vale treats it as a core option, does not recognise it,
    // and ignores it. Measured: `W101 … isn't a core option` on stderr, exit
    // zero, an empty result on stdout. Without the notice this is a clean run
    // with no findings — the rule is disabled and nothing says so.
    const cwd = makeProject(
      `${header}rules.no-simply = YES\n\n[*.md]\nBasedOnStyles =\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results).toEqual([]);
    expect(outcome.notice).toContain("W101");
    expect(outcome.notice).toContain("rules.no-simply");
  });

  it("reports no notice when Vale writes nothing to stderr", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.notice).toBeUndefined();
  });

  it("terminates and reports a timeout rather than hanging", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    // 1ms cannot survive process startup, so this exercises the kill path
    // without needing a pathological corpus to provoke it.
    const outcome = await runVale({ cwd, paths: ["doc.md"], timeoutMs: 1 });
    expect(outcome.status).toBe("timeout");
    if (outcome.status !== "timeout") return;
    expect(outcome.message).toContain("terminated");
  });

  describe("a target file Vale cannot parse (taskless/cli#300)", () => {
    // An unquoted colon in a YAML value, exactly the shape from the issue:
    // `description: this has a colon: right here` is not valid YAML, and
    // Vale's front-matter parser aborts on it before any file in the run is
    // linted.
    const badFrontMatter =
      "---\ndescription: this has a colon: right here\n---\n\nJust simply do it.\n";

    it("keeps every other file's findings instead of zeroing the whole run", async () => {
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        {
          "good-1.md": "Just simply do it.\n",
          "good-2.md": "Just simply do it, again.\n",
          "bad.md": badFrontMatter,
        }
      );

      const outcome = await runVale({
        cwd,
        paths: ["good-1.md", "good-2.md", "bad.md"],
      });

      // Before the fix this was `{ status: "failed", results: undefined }`
      // and the two good files' findings were gone. The run now completes:
      // one bad file costs one finding, not the other two.
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.blocking).toBe(false);

      const byFile = new Map(outcome.results.map((r) => [r.file, r]));
      expect(byFile.get("good-1.md")).toMatchObject({
        ruleId: "no-simply",
        file: "good-1.md",
      });
      expect(byFile.get("good-2.md")).toMatchObject({
        ruleId: "no-simply",
        file: "good-2.md",
      });
      expect(byFile.get("bad.md")).toMatchObject({
        source: "vale",
        ruleId: "vale-parse-error",
        severity: "error",
        file: "bad.md",
      });
      expect(byFile.get("bad.md")?.message).toContain("E201");
      expect(outcome.results).toHaveLength(3);
    });

    it("distinguishes a run that found nothing from a run that could not read anything", async () => {
      // The exact confusion from the issue: an empty `results` used to mean
      // both "clean corpus" and "the run never got to look at anything".
      const clean = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        { "doc.md": "Nothing objectionable here.\n" }
      );
      const cleanOutcome = await runVale({ cwd: clean, paths: ["doc.md"] });
      expect(cleanOutcome).toMatchObject({ status: "ok", results: [] });

      const unreadable = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        { "bad.md": badFrontMatter }
      );
      const unreadableOutcome = await runVale({
        cwd: unreadable,
        paths: ["bad.md"],
      });
      expect(unreadableOutcome.status).toBe("ok");
      if (unreadableOutcome.status !== "ok") return;
      // Not `[]`: a run that could read nothing must not look identical to a
      // clean pass, which is the whole failure this issue is about.
      expect(unreadableOutcome.results).not.toEqual([]);
      expect(unreadableOutcome.results).toHaveLength(1);
      expect(unreadableOutcome.results[0]).toMatchObject({
        ruleId: "vale-parse-error",
        file: "bad.md",
      });
    });

    it("drops more than one bad file, one finding per file", async () => {
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        {
          "good.md": "Just simply do it.\n",
          "bad-1.md": badFrontMatter,
          "bad-2.md": badFrontMatter,
        }
      );

      const outcome = await runVale({
        cwd,
        paths: ["good.md", "bad-1.md", "bad-2.md"],
      });

      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      const parseErrors = outcome.results.filter(
        (r) => r.ruleId === "vale-parse-error"
      );
      expect(parseErrors.map((r) => r.file).toSorted()).toEqual([
        "bad-1.md",
        "bad-2.md",
      ]);
      expect(outcome.results.find((r) => r.file === "good.md")).toMatchObject({
        ruleId: "no-simply",
      });
    });

    it("still blocks on a genuine rule-config error, without mistaking it for a target file", async () => {
      // A malformed RULE, not a malformed document. Its path lives under
      // `.taskless/rules/vale/`, not among the run's targets, so it must not
      // be excluded and retried as though it were one of the user's files —
      // that would spin forever trying to "drop" a file that is never in the
      // target set at all.
      const cwd = makeProject(
        `${header}\n[*.md]\nbogus.bogus = YES\n`,
        {
          bogus: `extends: existence\nmessage: "test"\nlevel: catastrophe\ntokens:\n  - simply\n`,
        },
        { "doc.md": "Just simply do it.\n" }
      );

      const outcome = await runVale({ cwd, paths: ["doc.md"] });
      expect(outcome.status).toBe("failed");
      if (outcome.status !== "failed") return;
      expect(outcome.blocking).toBe(true);
      expect(outcome.message).toContain("bogus.yml");
    });
  });

  describe("an oversized target file (taskless/cli#321)", () => {
    // Just over the limit, not a multi-hundred-KB fixture: this is a boundary
    // test, and repeating a short sentence to the byte count keeps the
    // workspace this test writes to disk small and the suite fast.
    //
    // The sentence contains the rule's own token ("simply") deliberately,
    // rather than filler with no matches. A filler body of repeated "x"
    // characters is excluded exactly the same as this one on the happy path
    // (both are just "some file over the limit" to `findOversizedFiles`), but
    // it hides a real regression: with the exclusion glob broken, Vale would
    // still be handed "xxxx…" and find nothing in it either way, so a test
    // built on filler cannot tell "excluded" from "checked and clean" apart.
    // A body with real matches can: excluded, it contributes no findings;
    // handed to Vale, it contributes many. Verified below.
    const oversizedSentence = "Just simply do it. ";
    const oversizedBody = oversizedSentence.repeat(
      Math.ceil((VALE_MAX_FILE_BYTES + 1) / oversizedSentence.length)
    );
    // Sized so the WHOLE document (this padding plus the sentence appended
    // below) lands at EXACTLY `VALE_MAX_FILE_BYTES`, not merely under it: the
    // guard has to be a strict `>`, and a test that leaves slack would not
    // notice a `>=` mutation, since the file would still sit under the limit
    // either way. `"\nJust simply do it.\n"` is 20 bytes.
    const almostHugeSuffix = "\nJust simply do it.\n";
    const underLimitBody = "x".repeat(
      VALE_MAX_FILE_BYTES - almostHugeSuffix.length
    );

    it("excludes the oversized file while its neighbours' findings still come back", async () => {
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        {
          "good-1.md": "Just simply do it.\n",
          "good-2.md": "Just simply do it, again.\n",
          "huge.md": oversizedBody,
        }
      );

      const outcome = await runVale({
        cwd,
        paths: ["good-1.md", "good-2.md", "huge.md"],
      });

      // MUTATION CHECK: with the `...oversizedInScope.map((entry) =>
      // entry.file)` spread removed from `exclude` in run.ts, `huge.md` is
      // handed to Vale instead of excluded, and — because the fixture's
      // content actually contains "simply" thousands of times — Vale reports
      // one finding per match. `outcome.results` then has 3-digit length
      // instead of 2, which `toHaveLength(2)` below catches immediately.
      // Verified locally: with the spread removed, this test fails with
      // "expected 2600-ish, got 2" (the exact count depends on Vale's
      // scope-merging, not asserted here to keep the test robust); reverting
      // restores it to exactly 2.
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.blocking).toBe(false);

      const byFile = new Map(outcome.results.map((r) => [r.file, r]));
      expect(byFile.get("good-1.md")).toMatchObject({
        ruleId: "no-simply",
        file: "good-1.md",
      });
      expect(byFile.get("good-2.md")).toMatchObject({
        ruleId: "no-simply",
        file: "good-2.md",
      });
      // No `huge.md` finding: despite containing "simply" thousands of times,
      // it was excluded before Vale ever opened it.
      expect(outcome.results).toHaveLength(2);
    });

    it("reports the skip as a notice, not a finding", async () => {
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        { "huge.md": oversizedBody }
      );

      const outcome = await runVale({ cwd, paths: ["huge.md"] });

      // MUTATION CHECK: remove `oversizedFilesNotice(oversizedInScope, ...)`
      // from the `notices` array in run.ts and `outcome.notice` comes back
      // `undefined` — verified locally. A silent skip here is exactly the
      // failure mode the whole issue is about, one level down: `results` is
      // empty (the file was excluded, so `no-simply` never got to run on it,
      // despite the fixture containing that token thousands of times), so the
      // notice is the ONLY signal this file was declined rather than checked
      // and found clean.
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.results).toEqual([]);
      expect(outcome.notice).toContain("huge.md");
      expect(outcome.notice).toContain(String(VALE_MAX_FILE_BYTES));
    });

    it("still checks a file just under the limit", async () => {
      const almostHugeBody = `${underLimitBody}${almostHugeSuffix}`;
      const cwd = makeProject(
        `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
        { "no-simply": existenceRule("simply", "Avoid 'simply'") },
        { "almost-huge.md": almostHugeBody }
      );

      // The file is exactly `VALE_MAX_FILE_BYTES`, not merely under it — see
      // the `underLimitBody` comment above.
      expect(Buffer.byteLength(almostHugeBody)).toBe(VALE_MAX_FILE_BYTES);

      const outcome = await runVale({ cwd, paths: ["almost-huge.md"] });

      // MUTATION CHECK: change the size guard's comparison from `>` to `>=`
      // in `findOversizedFiles` and this test fails, since the fixture sits
      // AT the limit: `almost-huge.md` would start being excluded (a notice
      // naming it, no `no-simply` finding). Verified locally.
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(outcome.notice).toBeUndefined();
      expect(outcome.results).toContainEqual(
        expect.objectContaining({
          ruleId: "no-simply",
          file: "almost-huge.md",
        })
      );
    });
  });
});

describe("ValeRunOutcome.blocking", () => {
  it("marks an absent binary non-blocking", async () => {
    // An unsupported arch is an ordinary state, not evidence that the user's
    // rules are wrong. Blocking here would make `check` unrunnable on a machine
    // where ast-grep and runtime rules report perfectly well.
    const binary = await import("../src/rules/vale/binary");
    vi.spyOn(binary, "findValeBinary").mockReturnValue({
      path: undefined,
      source: undefined,
      tried: ["@taskless/vale-darwin-arm64", "node_modules/.bin", "PATH"],
    });

    expect(await runVale({ cwd: process.cwd() })).toMatchObject({
      status: "unavailable",
      blocking: false,
    });
  });
});

withVale("ValeRunOutcome.blocking against the real binary", () => {
  it("marks a timeout blocking", async () => {
    // Vale was present and asked to work. Reporting this as a skip would let a
    // broken rule file read as "no Vale findings" — indistinguishable from a
    // clean run, and how a silently disabled engine ships.
    //
    // THE BUDGET AND THE INPUT ARE BOTH LOAD-BEARING, and an earlier version
    // of this test got it wrong. It gave a 1ms budget to a one-line document,
    // which asserts the winner of a race: the timer has to fire before a child
    // that runs in its OWN process and does not care whether our event loop is
    // free. Measured, that document takes Vale about 46ms, so 1ms normally
    // wins — but under load the timer's callback is delayed while the child
    // keeps going, and it was seen losing once across four concurrent
    // full-suite runs, reporting a clean "ok" where the test demanded a
    // "timeout".
    //
    // The race is removed by making the work outlast the budget by a margin
    // nothing plausible closes. Vale is QUADRATIC in the size of a single
    // file, so a document well under a second's worth of Vale time is still
    // many multiples of a 100ms budget.
    //
    // The fixture has to stay UNDER `VALE_MAX_FILE_BYTES` (taskless/cli#321):
    // a document at or above that limit is excluded before Vale ever sees it,
    // which would report `status: "ok"` with a notice instead of exercising
    // the timeout this test is actually about. 6,300 repeats of a 19-byte
    // sentence lands at ~117KB (119,700 bytes), comfortably below the 128KB
    // limit — measured at ~450ms against the real binary, a ~4.5x margin over
    // the 100ms budget used here. That margin is smaller than this test used
    // before #321 shrank how large a fixture it may use, but it is measured,
    // not assumed, and the run is killed at 100ms either way, so the test
    // costs about that rather than 450ms.
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it. ".repeat(6_300) }
    );

    expect(
      await runVale({ cwd, paths: ["doc.md"], timeoutMs: 100 })
    ).toMatchObject({ status: "timeout", blocking: true });
  });

  it("marks a rejected configuration blocking", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nbogus.bogus = YES\n`,
      {
        bogus: `extends: existence\nmessage: "test"\nlevel: catastrophe\ntokens:\n  - simply\n`,
      },
      { "doc.md": "Just simply do it.\n" }
    );

    expect(await runVale({ cwd, paths: ["doc.md"] })).toMatchObject({
      status: "failed",
      blocking: true,
    });
  });

  it("marks findings non-blocking; severity decides the exit code", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    expect(await runVale({ cwd, paths: ["doc.md"] })).toMatchObject({
      status: "ok",
      blocking: false,
    });
  });
});
