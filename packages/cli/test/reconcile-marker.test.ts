import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as {
      stdout: string;
      stderr: string;
      code?: number;
    };
    return {
      stdout: failure.stdout,
      stderr: failure.stderr,
      exitCode: failure.code ?? 1,
    };
  }
}

/**
 * The marker records that RULE CONTENT was reconciled, which nothing else in
 * the manifest does. `install.cliVersion` moves on a skills refresh and the
 * scaffold `version` moves on a layout migration, both without anyone reading
 * a rule, so neither can stand in for this.
 */
describe("recording a rules reconciliation", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-ledger-"));
    await cp(
      resolve(import.meta.dirname, "../../../.taskless"),
      join(cwd, ".taskless"),
      { recursive: true }
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function readRules(): Promise<Record<string, unknown> | undefined> {
    const raw = await readFile(join(cwd, ".taskless", "taskless.json"), "utf8");
    return (JSON.parse(raw) as { rules?: Record<string, unknown> }).rules;
  }

  async function installedVersion(): Promise<string> {
    const result = await runCli(["info", "--json", "-d", cwd]);
    return (JSON.parse(result.stdout) as { version: string }).version;
  }

  it("records the version and the engines the rules are valid against", async () => {
    const version = await installedVersion();
    const result = await runCli([
      "update",
      `--reconciledTo=${version}`,
      "-d",
      cwd,
    ]);
    expect(result.exitCode).toBe(0);

    const rules = await readRules();
    expect(rules?.reconciledTo).toBe(version);
    // Engine versions are the input a later differential needs. Recorded here
    // and nowhere else, so an upgrade cannot silently refresh them.
    expect(rules?.engines).toEqual({ sg: "0.45.2", vale: "3.18.0" });
  });

  it("reports the marker through info", async () => {
    const version = await installedVersion();
    await runCli(["update", `--reconciledTo=${version}`, "-d", cwd]);

    const info = await runCli(["info", "--json", "-d", cwd]);
    const parsed = JSON.parse(info.stdout) as {
      rules: { reconciledTo: string | null };
    };
    expect(parsed.rules.reconciledTo).toBe(version);
  });

  it("refuses a version this CLI has no entries for", async () => {
    // The quiet failure this prevents: recording a version whose ledger
    // sections do not exist here, so a later walk starts past work nobody did.
    const result = await runCli([
      "update",
      "--reconciledTo=99.0.0",
      "--json",
      "-d",
      cwd,
    ]);
    expect(result.exitCode).not.toBe(0);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("INVALID_INPUT");
    expect(await readRules()).toBeUndefined();
  });

  it("refuses to move the marker backwards", async () => {
    const version = await installedVersion();
    await runCli(["update", `--reconciledTo=${version}`, "-d", cwd]);

    const result = await runCli([
      "update",
      "--reconciledTo=0.0.1",
      "--json",
      "-d",
      cwd,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect((JSON.parse(result.stdout) as { code: string }).code).toBe(
      "INVALID_INPUT"
    );
    // Unchanged, not clobbered with the rejected value.
    const rules = await readRules();
    expect(rules?.reconciledTo).toBe(version);
  });

  it("refuses a value that is not a version", async () => {
    // `versionCore` coerces an unparseable segment to 0, so garbage compares
    // LOWER than any real version and would sail past both guards to be
    // written verbatim. A pasted SHA or a truncated interpolation would
    // corrupt the marker with nothing reported, which is the opposite of the
    // validation this command claims to do.
    for (const bad of ["abc", "", "0.11.0; rm -rf /", "deadbeef"]) {
      const result = await runCli([
        "update",
        `--reconciledTo=${bad}`,
        "--json",
        "-d",
        cwd,
      ]);
      expect(result.exitCode, `accepted ${JSON.stringify(bad)}`).not.toBe(0);
    }
    expect(await readRules()).toBeUndefined();
  });

  it("refuses when there is no .taskless/ to reconcile", async () => {
    // `readManifest` tolerates a missing file but `writeManifest` does not
    // create parent directories, so this used to die on a raw ENOENT reported
    // as INTERNAL_ERROR. Checked rather than created: creating it would record
    // a reconciliation for a project that has no rules, which is the marker
    // claiming work that could not have happened.
    const empty = await mkdtemp(join(tmpdir(), "taskless-noscaffold-"));
    try {
      const result = await runCli([
        "update",
        `--reconciledTo=${await installedVersion()}`,
        "--json",
        "-d",
        empty,
      ]);
      expect(result.exitCode).not.toBe(0);
      const envelope = JSON.parse(result.stdout) as {
        code: string;
        message: string;
      };
      expect(envelope.code).toBe("INVALID_INPUT");
      expect(envelope.code).not.toBe("INTERNAL_ERROR");
      expect(envelope.message).toContain("no rules to reconcile");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("leaves install untouched, since the two namespaces drift apart", async () => {
    const before = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { install?: unknown };
    await runCli([
      "update",
      `--reconciledTo=${await installedVersion()}`,
      "-d",
      cwd,
    ]);
    const after = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { install?: unknown };
    expect(after.install).toEqual(before.install);
  });
});

describe("taskless update with no flags", () => {
  it("honours --json, reporting the recipe and where the walk starts", async () => {
    // The flag used to be read only on the recording path, so this printed
    // plain prose and gave no sign it had done nothing. The walk start is
    // computed by the CLI rather than reasoned out of the recipe's prose:
    // two places deriving one answer can disagree.
    const result = await runCli(["update", "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      topic: string;
      installed: string;
      walk: unknown;
      recipe: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.topic).toBe("update");
    expect(payload.installed).toBeTruthy();
    expect(payload.recipe).toContain("# Topic: update");
    // No marker recorded here, so there is nothing to walk. That is not the
    // same as being behind, and it must not read as a version to walk from.
    expect(payload.walk).toBeNull();
  });

  it("serves the same ledger recipe as `agent update`", async () => {
    const direct = await runCli(["update"]);
    const viaAgent = await runCli(["agent", "update"]);
    expect(direct.exitCode).toBe(0);
    expect(direct.stdout).toContain("# Topic: update");
    // One renderer, so the two spellings cannot drift into two different sets
    // of instructions.
    expect(direct.stdout).toBe(viaAgent.stdout);
  });

  it("tells the reader the layout and the rules are different jobs", async () => {
    const result = await runCli(["update"]);
    expect(result.stdout).toContain("It is not about installing");
    expect(result.stdout).toContain("The directory is");
  });

  it("carries the 0.11.0 ledger entry", async () => {
    const result = await runCli(["update"]);
    expect(result.stdout).toContain("Migrating to 0.11.0");
    // The four things an author cannot discover from the diff.
    expect(result.stdout).toContain("rewriter now requires `fix`");
    expect(result.stdout).toContain("Markdown is now a language");
    expect(result.stdout).toContain("Matching semantics moved");
  });

  it("warns that kind: link is loud, not a silent zero-match", async () => {
    // The correction that took a verified 0.45.2 binary to establish: an
    // invalid kind aborts config parsing and takes every other rule down.
    const result = await runCli(["update"]);
    expect(result.stdout).toContain("HARD\nCONFIG ERROR");
    expect(result.stdout).toContain("exit 8");
  });
});
