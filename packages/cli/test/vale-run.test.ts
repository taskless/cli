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
  while (workspaces.length > 0) {
    rmSync(workspaces.pop() as string, { recursive: true, force: true });
  }
});

/** A project with the committed Vale layout: `config` plus rule files. */
function makeProject(
  config: string,
  rules: Record<string, string>,
  documents: Record<string, string>
): string {
  const cwd = mkdtempSync(join(tmpdir(), "vale-run-"));
  workspaces.push(cwd);
  mkdirSync(join(cwd, ".taskless", "vale", "rules"), { recursive: true });
  writeFileSync(join(cwd, ".taskless", "vale", ".vale.ini"), config);
  for (const [name, body] of Object.entries(rules)) {
    writeFileSync(join(cwd, ".taskless", "vale", "rules", `${name}.yml`), body);
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
const header = "StylesPath = .\nMinAlertLevel = suggestion\n";

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
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
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
    expect(result.range.start.line).toBe(3);
    expect(result.range.end.line).toBe(3);
  });

  it("produces no findings, and no error, on a clean document", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
      { "no-simply": existenceRule("simply", "Avoid 'simply'") },
      { "doc.md": "Nothing objectionable here.\n" }
    );

    const outcome = await runVale({ cwd, paths: ["doc.md"] });
    // Vale prints nothing at all when it finds nothing; that must read as an
    // empty result rather than as unparseable output.
    expect(outcome).toEqual({ status: "ok", results: [] });
  });

  it("normalizes suggestion to hint", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.soft = YES\n`,
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
        `${header}\n[marketing/**]\nrules.no-simply = YES\n`,
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

    it("lets a disable win over an enable, regardless of order", async () => {
      const cwd = makeProject(
        `${header}\n[marketing/**]\nrules.no-simply = YES\n\n[marketing/legacy/**]\nrules.no-simply = NO\n`,
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
        `${header}\n[*.md]\nrules.no-simply = YES\n\n[*.md]\nrules.no-very = YES\n`,
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

  it("terminates and reports a timeout rather than hanging", async () => {
    const cwd = makeProject(
      `${header}\n[*.md]\nrules.no-simply = YES\n`,
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
