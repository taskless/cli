import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findValeBinary } from "../src/rules/vale/binary";
import { migrateFixture } from "./support/current-project";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/mixed-engines-project"
);

/**
 * End-to-end over a project both engines have work in.
 *
 * The unit suites mock at the seam they are testing — `vale-orchestration`
 * stubs `runVale`, `vale-run` builds configs in a temp directory. Nothing
 * exercised a committed project the way a user has one: both engine directories
 * populated, both native configs on disk as authored, and the real binary
 * resolved for each. That gap is not theoretical. The scaffolded `.vale.ini`
 * carried a `StylesPath` under which no rule could resolve, so Vale reported
 * `{}` and a check over prose rules passed clean — invisible to every test that
 * generated its own config.
 */

/** Run the built CLI, tolerating a non-zero exit. */
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await migrateFixture(args);

  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code,
    };
  }
}

interface CheckFinding {
  source: string;
  ruleId: string;
  severity: string;
  file: string;
}

interface CheckOutput {
  success: boolean;
  results: CheckFinding[];
}

/** Vale ships per-platform; an unsupported host has none. */
const withVale = findValeBinary().path === undefined ? describe.skip : describe;

describe("check over a project with both engines", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-mixed-"));
    await cp(fixturesDirectory, project, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  withVale("with the Vale binary available", () => {
    it("reports findings from both engines in one run", async () => {
      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;
      const sources = new Set(output.results.map((finding) => finding.source));

      // The claim this file exists to make: one invocation, both engines.
      expect(sources).toContain("ast-grep");
      expect(sources).toContain("vale");
      expect(exitCode).toBe(1);
      expect(output.success).toBe(false);
    });

    it("attributes each finding to the engine and file it came from", async () => {
      const { stdout } = await runCli(["check", "-d", project, "--json"]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;
      const byRule = new Map(output.results.map((f) => [f.ruleId, f]));

      // Code rules see the code file, prose rules see the document. A merged
      // result set makes crossing them easy to miss, so pin the pairing.
      expect(byRule.get("no-eval")).toMatchObject({
        source: "ast-grep",
        severity: "error",
        file: "sample.js",
      });
      expect(byRule.get("no-console-warn")).toMatchObject({
        source: "ast-grep",
        severity: "warning",
        file: "sample.js",
      });
      expect(byRule.get("no-simply")).toMatchObject({
        source: "vale",
        severity: "warning",
        file: "README.md",
      });
      expect(byRule.get("no-obviously")).toMatchObject({
        source: "vale",
        severity: "error",
        file: "README.md",
      });
    });

    it("strips Vale's styles prefix from the reported rule id", async () => {
      // Vale reports `rules.no-simply`, named for the styles directory. A user
      // authored `no-simply`, so that is what a finding has to say.
      const { stdout } = await runCli(["check", "-d", project, "--json"]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;
      const valeRules = output.results
        .filter((finding) => finding.source === "vale")
        .map((finding) => finding.ruleId);

      expect(valeRules.length).toBeGreaterThan(0);
      for (const ruleId of valeRules) {
        expect(ruleId).not.toContain("rules.");
      }
    });

    it("names both engines in human output", async () => {
      const { stdout } = await runCli(["check", "-d", project]);
      expect(stdout).toContain("no-eval");
      expect(stdout).toContain("no-simply");
      expect(stdout).toContain("sample.js");
      expect(stdout).toContain("README.md");
    });

    it("fails on a prose rule even when the code is clean", async () => {
      // Vale alone must be able to fail a check. Otherwise a prose-only project
      // reports success no matter what it says.
      await rm(join(project, "sample.js"));
      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;

      // `every` is vacuously true on an empty set, so assert presence first —
      // otherwise a Vale that found nothing at all passes this test.
      expect(output.results.length).toBeGreaterThan(0);
      expect(output.results.every((f) => f.source === "vale")).toBe(true);
      expect(exitCode).toBe(1);
    });

    it("still reports code findings when the prose is clean", async () => {
      // The mirror of the case above, and the one that would hide a Vale that
      // silently found nothing: ast-grep carries the run either way.
      await rm(join(project, "README.md"));
      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;

      expect(output.results.length).toBeGreaterThan(0);
      expect(output.results.every((f) => f.source === "ast-grep")).toBe(true);
      expect(exitCode).toBe(1);
    });
  });

  withVale("never lints Taskless's own directory", () => {
    it("reports nothing under .taskless on a whole-project check", async () => {
      // Vale has no reason to know `.taskless/` is ours, and a whole-project
      // walk reaches it: with a rule enabled it reported findings in the
      // committed `.vale.ini` and in the user's own rule definitions — prose
      // complaints about the machinery. Section globs do not help, because
      // `.taskless/README.md` matches `[*.md]` as readily as any document.
      await writeFile(
        join(project, ".taskless", "README.md"),
        "This readme simply describes things, and obviously so.\n"
      );

      const { stdout } = await runCli(["check", "-d", project, "--json"]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;

      // Vale still ran — otherwise this passes for the wrong reason.
      expect(output.results.some((f) => f.source === "vale")).toBe(true);
      expect(
        output.results.filter((f) => f.file.startsWith(".taskless"))
      ).toEqual([]);
    });

    it("still checks an explicitly named path inside .taskless", async () => {
      // The exclusion is ours, not the user's. Naming a path is a request, and
      // silently declining to check a file someone asked for would be worse
      // than checking one they did not.
      // Deliberately NOT `README.md`. That file is generated and a migration
      // rewrites it, so using it here made this test depend on whether a
      // migration happened to run during the check — which it started doing
      // the moment a new migration was added. The subject is the exclusion,
      // not the file.
      await writeFile(
        join(project, ".taskless", "notes.md"),
        "These notes simply describe things.\n"
      );

      const { stdout } = await runCli([
        "check",
        "-d",
        project,
        "--json",
        ".taskless/notes.md",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;

      expect(
        output.results.some(
          (f) => f.source === "vale" && f.file === ".taskless/notes.md"
        )
      ).toBe(true);
    });
  });

  withVale("the scaffolded config a real project starts from", () => {
    it("resolves a rule dropped into the scaffolded vale directory", async () => {
      // The guard for the bug this file found. `migrate-engine-layout` asserts
      // `.vale.ini` EXISTS; it never asked whether a rule under it could
      // resolve. It could not — `StylesPath` pointed at `rules/`, making that
      // directory a style with no rules in it, so every check resolved to
      // nothing and Vale returned `{}`. A user would author a rule, watch
      // `rule verify` pass (verify generates its own config), and never see it
      // fire in `check`.
      //
      // Deliberately goes through `init` rather than importing the constant, so
      // it tests the config a user actually gets rather than one we assert
      // about.
      const scaffold = await mkdtemp(join(tmpdir(), "taskless-scaffold-"));
      try {
        const init = await runCli(["init", "-d", scaffold]);
        expect(init.exitCode).toBe(0);

        // Author the rule the way a user would: one directory holding the
        // style and the matcher that scopes it. No shared file is touched.
        const ruleDirectory = join(
          scaffold,
          ".taskless",
          "rules",
          "vale",
          "no-simply"
        );
        await mkdir(ruleDirectory, { recursive: true });
        await writeFile(
          join(ruleDirectory, "no-simply.yml"),
          "extends: existence\nmessage: \"Avoid 'simply'\"\nlevel: warning\ntokens:\n  - simply\n"
        );
        await writeFile(
          join(ruleDirectory, ".vale.ini"),
          "[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\n"
        );
        await writeFile(join(scaffold, "doc.md"), "Just simply do it.\n");

        const { stdout } = await runCli(["check", "-d", scaffold, "--json"]);
        const output = JSON.parse(stdout.trim()) as CheckOutput;

        expect(
          output.results.some(
            (finding) =>
              finding.source === "vale" && finding.ruleId === "no-simply"
          )
        ).toBe(true);
      } finally {
        await rm(scaffold, { recursive: true, force: true });
      }
    });

    // The pairing that keeps a per-rule config honest. Scope is the author's
    // decision, which means the assignment can land above every matcher in
    // their own `.vale.ini`. Vale does not error on that: it warns `W101` on
    // stderr, exits zero, and returns a well-formed empty result, which is
    // indistinguishable from a clean run.
    //
    // The config schema now turns that file away before Vale ever sees it, at
    // `verify` (a rejection under `vale-config-no-root-keys`) and at `check`
    // (the Vale engine's failure, which reaches the exit code). The run-time
    // W101 notice is still pinned, in `vale-run.test.ts`, for the diagnostics
    // the schema cannot foresee; this is the case it can.
    it("refuses the Vale run when an assignment sits outside every matcher", async () => {
      const rule = join(project, ".taskless", "rules", "vale", "no-simply");
      // The mistake: enabled, but above the `[…]` line, so it belongs to no
      // matcher. A matcher exists and the check is named, so the substring
      // checks `verify` used to run passed this; the schema does not.
      await writeFile(
        join(rule, ".vale.ini"),
        "no-simply.no-simply = YES\n[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\n"
      );

      const verified = await runCli(["verify", "-d", project, "--json"]);
      expect(verified.exitCode).not.toBe(0);
      const report = JSON.parse(verified.stdout) as {
        rules: { ruleId: string; violations: { constraintId: string }[] }[];
      };
      const rejected = report.rules.find(
        (entry) => entry.ruleId === "no-simply"
      );
      expect(
        rejected?.violations.map((violation) => violation.constraintId)
      ).toContain("vale-config-no-root-keys");

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput & {
        failures?: string[];
        notices?: string[];
      };

      // Refused rather than stripped: the failure names the rule and the line,
      // and the exit code hears it. Vale is never run, so the run-time W101
      // notice that used to be the last line of defence has nothing to say.
      expect(exitCode).toBe(1);
      expect(output.success).toBe(false);
      expect(output.failures).toHaveLength(1);
      expect(output.failures?.[0]).toContain("Vale did not run");
      expect(output.failures?.[0]).toContain("no-simply/.vale.ini line 1:");
      expect(output.failures?.[0]).toContain("no-simply.no-simply");
      expect(output.notices).toBeUndefined();

      // The other engine is unaffected: ast-grep still reports, and Vale, which
      // was refused, reports nothing rather than something partial.
      const sources = new Set(output.results.map((finding) => finding.source));
      expect(sources).toContain("ast-grep");
      expect(sources).not.toContain("vale");
    });

    // The cross-rule prohibition the spec has always stated and nothing
    // enforced: a rule cannot override another rule's matchers. The offending
    // config here is `no-simply`'s, so its neighbour `no-obviously`, which is
    // fine, is not the rule named.
    it("refuses the Vale run when a rule assigns another rule's key", async () => {
      const rule = join(project, ".taskless", "rules", "vale", "no-simply");
      await writeFile(
        join(rule, ".vale.ini"),
        "[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\nno-obviously.no-obviously = NO\n"
      );

      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput & {
        failures?: string[];
      };

      expect(exitCode).toBe(1);
      expect(output.failures).toHaveLength(1);
      expect(output.failures?.[0]).toContain("the config of no-simply was");
      expect(output.failures?.[0]).toContain("no-simply/.vale.ini line 5:");
      expect(output.failures?.[0]).toContain("no-obviously.no-obviously");
      expect(output.failures?.[0]).not.toContain("config of no-obviously");

      const sources = new Set(output.results.map((finding) => finding.source));
      expect(sources).toContain("ast-grep");
      expect(sources).not.toContain("vale");
    });

    // An advisory is said, not refused: the run proceeds and the exit code
    // hears only the findings.
    it("carries a config advisory as a notice on a run that still happens", async () => {
      const rule = join(project, ".taskless", "rules", "vale", "no-simply");
      await writeFile(
        join(rule, ".vale.ini"),
        "[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\n\n[.taskless/**]\ntskl) rule = no-simply\nno-simply.no-simply = NO\n"
      );

      const { stdout } = await runCli(["check", "-d", project, "--json"]);
      const output = JSON.parse(stdout.trim()) as CheckOutput & {
        failures?: string[];
        notices?: string[];
      };

      expect(output.failures).toBeUndefined();
      expect(output.notices?.join("\n")).toContain("[.taskless/**]");
      expect(output.notices?.join("\n")).toContain("unnecessary");
      const sources = new Set(output.results.map((finding) => finding.source));
      expect(sources).toContain("vale");
    });
  });

  withVale("a target file check cannot parse (taskless/cli#300)", () => {
    // The exact shape from the issue: one file whose front matter has an
    // unquoted colon used to take every other file's findings down with it.
    // `check content/blog --json` came back `{"results":[]}`, indistinguishable
    // from a directory with nothing to say.
    it("still reports every other file's findings, end to end", async () => {
      const scaffold = await mkdtemp(join(tmpdir(), "taskless-parse-error-"));
      try {
        const init = await runCli(["init", "-d", scaffold]);
        expect(init.exitCode).toBe(0);

        const rule = join(scaffold, ".taskless", "rules", "vale", "no-simply");
        await mkdir(rule, { recursive: true });
        await writeFile(
          join(rule, "no-simply.yml"),
          "extends: existence\nmessage: \"Avoid 'simply'\"\nlevel: warning\ntokens:\n  - simply\n"
        );
        await writeFile(
          join(rule, ".vale.ini"),
          "[*.md]\ntskl) rule = no-simply\nBasedOnStyles =\nno-simply.no-simply = YES\n"
        );

        const blog = join(scaffold, "content", "blog");
        await mkdir(blog, { recursive: true });
        await writeFile(
          join(blog, "good-1.md"),
          "---\ntitle: Good post one\n---\n\nJust simply do it.\n"
        );
        await writeFile(
          join(blog, "good-2.md"),
          "---\ntitle: Good post two\n---\n\nJust simply do it, again.\n"
        );
        await writeFile(
          join(blog, "zzz-probe.md"),
          "---\ndescription: this has a colon: right here so it cannot parse\n---\n\nSome content, simply written.\n"
        );

        const { stdout, exitCode } = await runCli([
          "check",
          "content/blog",
          "-d",
          scaffold,
          "--json",
        ]);
        const output = JSON.parse(stdout.trim()) as CheckOutput;

        // Before the fix: `{"success":false,"results":[],"failures":[…]}` —
        // both good files' findings gone over one bad one.
        expect(output.success).toBe(false);
        expect(exitCode).toBe(1);

        const byFile = new Map(output.results.map((f) => [f.file, f]));
        expect(byFile.get("content/blog/good-1.md")).toMatchObject({
          source: "vale",
          ruleId: "no-simply",
        });
        expect(byFile.get("content/blog/good-2.md")).toMatchObject({
          source: "vale",
          ruleId: "no-simply",
        });
        expect(byFile.get("content/blog/zzz-probe.md")).toMatchObject({
          source: "vale",
          ruleId: "vale-parse-error",
          severity: "error",
        });
      } finally {
        await rm(scaffold, { recursive: true, force: true });
      }
    });
  });

  describe("whatever the host provides", () => {
    it("reports ast-grep findings regardless of Vale's availability", async () => {
      // Deliberately ungated, and deliberately not mocking the binary away: the
      // CLI runs as a subprocess here, so a `vi.spyOn` in this process would not
      // reach it. What this pins is the property that holds on every host —
      // ast-grep carries the run, and an absent Vale cannot take it down with
      // it. On a machine with Vale this passes alongside prose findings; on one
      // without, it passes with a notice instead. The exit code comes from the
      // error-severity code rule either way.
      const { stdout, exitCode } = await runCli([
        "check",
        "-d",
        project,
        "--json",
      ]);
      const output = JSON.parse(stdout.trim()) as CheckOutput;

      expect(
        output.results.some(
          (finding) =>
            finding.source === "ast-grep" && finding.ruleId === "no-eval"
        )
      ).toBe(true);
      expect(exitCode).toBe(1);
    });
  });
});
