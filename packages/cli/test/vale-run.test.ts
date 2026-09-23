import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { runVale } from "../src/rules/vale/run";

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
    expect(outcome).toEqual({
      status: "ok",
      blocking: false,
      results: [],
      notices: [],
    });
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
    //
    // `check` no longer reaches Vale with this file: the config schema rejects
    // a root-level assignment at assembly. The config is hand-written here and
    // handed to `runVale` directly, deliberately around the schema, because
    // the notice path has to stay pinned for the diagnostics the schema cannot
    // foresee, and W101 is the one Vale is known to emit on a zero exit.
    const cwd = makeProject(
      `${header}rules.no-simply = YES\n\n[*.md]\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results).toEqual([]);
    // One notice per element. Asserting on the element rather than on the
    // whole field is what makes a producer that glued two advisories together
    // fail here instead of passing a substring match.
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toContain("W101");
    expect(outcome.notices[0]).toContain("rules.no-simply");
  });

  it("reports no notices when Vale writes nothing to stderr", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.notices).toEqual([]);
  });

  it("terminates and reports a timeout rather than hanging", async () => {
    // THE BUDGET AND THE INPUT ARE BOTH LOAD-BEARING. This asserted the winner
    // of a race until taskless/cli#327: a 1ms budget against a one-line
    // document, on the stated grounds that "1ms cannot survive process
    // startup". That is not something the test controls. Vale runs in its OWN
    // process and does not care whether our event loop is free, so under load
    // the timer's callback is delayed while the child keeps going, and the run
    // completes cleanly where the test demanded a timeout.
    //
    // NO ISSUE EVER FLAGGED THIS TEST. It was found while investigating
    // taskless/cli#262, which reports a different flake entirely — two
    // SUBPROCESS-SPAWNING tests in `error-envelope.test.ts` and
    // `verify-test-commands.test.ts` — and does not name this one. #262 is
    // where the search started, not what it found, and it remains open.
    //
    // Its sibling in `ValeRunOutcome.blocking` had the identical shape and was
    // MEASURED failing that way, reporting `status: "ok"`, before it was given
    // a real margin. This test survived only because its window was narrower,
    // not because it was safe.
    //
    // TWO SEPARATE MEASUREMENT PASSES COUNTED THAT SIBLING, which is why the
    // numbers here and in its own comment below differ and neither is wrong.
    // The first, while #323 was open, saw it lose ONCE ACROSS FOUR concurrent
    // full-suite runs. The second, counting a set of captured logs recovered
    // later, saw TWICE ACROSS 13. Same test, same failure, different samples.
    //
    // The metric that matters is the ABSOLUTE margin (duration minus budget),
    // not a ratio: what has to happen is the child finishing before a delayed
    // timer callback runs. Measured on this fixture, warm, on Vale 3.20.0:
    //
    // | fixture         | bytes  | duration | headroom over 100ms |
    // | --------------- | ------ | -------- | ------------------- |
    // | 19 (the old one)| 362    | ~46ms    | 45ms — this flaked  |
    // | 8,000           | 152KB  | ~1020ms  | ~920ms              |
    // | 17,000 (sibling)| 323KB  | ~4430ms  | ~4330ms             |
    //
    // THE FIXTURE IS A PROPERTY OF THE PINNED BINARY, AND A BUMP RE-MEASURES
    // IT. Vale 3.21.0 shipped two perf commits (rune-position indexing and
    // walker-context indexing) that made this workload ~20x faster: the
    // 8,000-repetition fixture ran in ~45ms, UNDER the 100ms budget, and this
    // test failed outright with `status: "ok"` — the same failure mode as the
    // original 19-repetition flake, reached from the other side. Re-measured
    // on 3.21.0, the binary alone, warm, three runs each:
    //
    // | fixture   | bytes  | duration  | headroom over 100ms |
    // | --------- | ------ | --------- | ------------------- |
    // | 8,000     | 152KB  | ~45ms     | NEGATIVE — failed   |
    // | 80,000    | 1.5MB  | ~235ms    | ~135ms              |
    // | 320,000   | 6.1MB  | ~890ms    | ~790ms              |
    // | 350,000   | 6.7MB  | ~1000ms   | ~900ms              |
    // | 640,000   | 12MB   | ~1900ms   | ~1800ms             |
    //
    // 350,000 restores the ~900ms headroom the 8,000 fixture had on 3.20.0.
    // The cost scales linearly (~2.8µs per repetition), so the next bump can
    // pick a number from one timing rather than a search. Re-measured on
    // 3.22.0 the same way: 80,000 at ~240ms, 350,000 at ~980ms, 1,000,000
    // at ~2,970ms, within noise of 3.21.0, so the fixture stands. It is chosen over
    // the sibling's 1,000,000 for the same reason 8,000 was chosen over
    // 17,000: this test asserts the message rather than the blocking flag,
    // which the sibling covers with the larger fixture.
    //
    // Nothing excludes a document this size before Vale sees it. The 128KB
    // guard that once did (taskless/cli#321) was written against 3.20.0's
    // superlinear cost and removed once 3.21.0 made it linear
    // (taskless/cli#351), which is also why the fixture needs no per-call
    // override to reach the binary.
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": `${"Just simply do it. ".repeat(350_000)}\n` }
    );

    const outcome = await runVale({
      cwd,
      paths: ["doc.md"],
      timeoutMs: 100,
    });
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
    // nothing plausible closes — and the metric that matters is the ABSOLUTE
    // margin (duration minus budget), not a ratio, because what has to happen
    // is the child process finishing before a delayed timer callback runs.
    // A ratio looks worse as the budget shrinks even when the real margin is
    // enormous, which is exactly what a review round measured wrong here
    // (taskless/cli#323): a "35x to 4.5x" ratio comparison on a version of
    // this test that had shrunk its fixture to fit under the then 128KB
    // file-size guard (taskless/cli#321) read as a regression, but the ratio
    // was the wrong number:
    //
    // | version                          | duration | budget | headroom |
    // | -------------------------------- | -------- | ------ | -------- |
    // | original, which actually flaked  | 46ms     | 1ms    | 45ms     |
    // | the 320KB fixture in e1ed936     | 3300ms   | 100ms  | 3200ms   |
    // | the 128KB-capped version (#323)  | ~530ms   | 100ms  | 430ms    |
    //
    // The 128KB-capped version was still ~10x the margin that actually
    // flaked — not a regression toward the failure mode — but it was a real
    // ~7x reduction from what e1ed936 shipped, worth restoring rather than
    // accepting.
    //
    // That size guard capped how large a fixture this test could use once it
    // started sharing `runVale`'s production guard (taskless/cli#321): a
    // document over the limit was excluded before Vale ever saw it, reporting
    // `status: "ok"` with a notice instead of exercising the timeout this
    // test is about, so a `maxFileBytes` seam raised the limit per call. The
    // guard and the seam are both gone (taskless/cli#351): 3.21.0 made the
    // cost linear, so no document is excluded on size any more and the
    // fixture reaches the binary as written.
    //
    // VALE 3.21.0 RE-MEASURED THE FIXTURE, AGAIN. Its perf work made this
    // workload ~20x faster, so 17,000 repetitions (323KB) ran in ~67ms on the
    // binary alone: the headroom was gone and this test was passing on spawn
    // overhead, the exact state the table above calls out as the one that
    // flaked. The 1,000,000-repetition fixture (19MB) measures ~2.8s on
    // 3.21.0 (linear at ~2.8µs per repetition; see the sibling's table),
    // restoring ~2.7s of headroom. The file is written and killed at 100ms,
    // so the size costs the write and nothing else.
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": `${"Just simply do it. ".repeat(1_000_000)}\n` }
    );

    expect(
      await runVale({
        cwd,
        paths: ["doc.md"],
        timeoutMs: 100,
      })
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
