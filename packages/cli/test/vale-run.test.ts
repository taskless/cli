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
    mkdirSync(join(cwd, ".taskless", "rules", "vale", name), { recursive: true });
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
      `${header}\n[*.md]\nrules.bogus = YES\n`,
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
});

describe("ValeRunOutcome.blocking", () => {
  it("marks an absent binary non-blocking", async () => {
    // An unsupported arch is an ordinary state, not evidence that the user's
    // rules are wrong. Blocking here would make `check` unrunnable on a machine
    // where ast-grep and runtime rules report perfectly well.
    const binary = await import("../src/rules/vale/binary");
    vi.spyOn(binary, "findValeBinary").mockReturnValue({
      path: undefined,
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
    const cwd = makeProject(
      `${header}\n[*.md]\nno-simply.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Just simply do it.\n" }
    );

    expect(
      await runVale({ cwd, paths: ["doc.md"], timeoutMs: 1 })
    ).toMatchObject({ status: "timeout", blocking: true });
  });

  it("marks a rejected configuration blocking", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.bogus = YES\n`,
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
