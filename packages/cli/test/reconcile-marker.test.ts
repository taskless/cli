import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // The fixture is a COPY OF THIS REPOSITORY'S OWN SCAFFOLD, which is what
    // makes it realistic and also what makes it leak: whatever `rules` block
    // this repo happens to carry arrives in the fixture, and `rules` is the
    // exact thing these tests assert about. They therefore silently depended
    // on this repository never having reconciled its own rules — which stopped
    // being true the moment it did, turning a legitimate `update --rules` into
    // five failures that named the repo's marker as the received value.
    //
    // Strip it, so the starting state is decided here rather than inherited.
    // Every test below sets up whatever marker it needs.
    const manifestPath = join(cwd, ".taskless", "taskless.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete manifest["rules"];
    await writeFile(manifestPath, JSON.stringify(manifest, undefined, 2));
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
    const result = await runCli(["update", "--rules", "-d", cwd]);
    expect(result.exitCode).toBe(0);

    const rules = await readRules();
    expect(rules?.reconciledTo).toBe(version);
    // Engine versions are the input a later differential needs. Recorded here
    // and nowhere else, so an upgrade cannot silently refresh them.
    expect(rules?.engines).toEqual({ sg: "0.45.2", vale: "3.18.0" });
  });

  it("reports the marker through info", async () => {
    const version = await installedVersion();
    await runCli(["update", "--rules", "-d", cwd]);

    const info = await runCli(["info", "--json", "-d", cwd]);
    const parsed = JSON.parse(info.stdout) as {
      rules: { reconciledTo: string | null };
    };
    expect(parsed.rules.reconciledTo).toBe(version);
  });

  it("refuses when there is no .taskless/ to reconcile", async () => {
    // `readManifest` tolerates a missing file but `writeManifest` does not
    // create parent directories, so this used to die on a raw ENOENT reported
    // as INTERNAL_ERROR. Checked rather than created: creating it would record
    // a reconciliation for a project that has no rules, which is the marker
    // claiming work that could not have happened.
    const empty = await mkdtemp(join(tmpdir(), "taskless-noscaffold-"));
    try {
      const result = await runCli(["update", "--rules", "--json", "-d", empty]);
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

  it("does not stamp a pre-existing project that never reconciled", async () => {
    // The silent skip this whole feature exists to prevent, reachable through
    // setup rather than through the walk. `init --no-interactive` is the
    // documented refresh path for an EXISTING project, and it runs after
    // `ensureTasklessDirectory` has already created the directory, so
    // "was this new" has to be sampled before that or it always reads new.
    //
    // Stamping here would mark a project that has walked nothing as fully
    // reconciled and skip every ledger entry.
    const before = await runCli(["update", "--json", "-d", cwd]);
    expect(
      (JSON.parse(before.stdout) as { walk: unknown }).walk
    ).not.toBeNull();

    await runCli(["init", "--no-interactive", "-d", cwd]);

    const after = await runCli(["update", "--json", "-d", cwd]);
    const walk = (
      JSON.parse(after.stdout) as {
        walk: { from: string } | null;
      }
    ).walk;
    expect(walk).not.toBeNull();
    expect(walk?.from).toBe("0.0.0");
  });

  it("reports the walk boundary on info as well, so callers agree", async () => {
    // The recipe tells an agent to read `rules.walk` from `info --json`. It
    // has to actually be there, or the guidance sends it looking for a field
    // that does not exist and back to deriving the boundary by hand.
    const result = await runCli(["info", "--json", "-d", cwd]);
    const rules = (
      JSON.parse(result.stdout) as {
        rules: { walk: { from: string } | null };
      }
    ).rules;
    expect(rules.walk?.from).toBe("0.0.0");
  });

  it("reports a walk from the baseline when no marker is recorded", async () => {
    // The behaviour that reaches existing projects: absent means "predates
    // the ledger", so every entry still applies.
    const result = await runCli(["update", "--json", "-d", cwd]);
    const payload = JSON.parse(result.stdout) as {
      reconciledTo: string | null;
      walk: { from: string; to: string } | null;
    };
    expect(payload.reconciledTo).toBeNull();
    expect(payload.walk?.from).toBe("0.0.0");
  });

  it("has nothing to walk once the rules are stamped", async () => {
    await runCli(["update", "--rules", "-d", cwd]);
    const result = await runCli(["update", "--json", "-d", cwd]);
    const payload = JSON.parse(result.stdout) as { walk: unknown };
    expect(payload.walk).toBeNull();
  });

  it("leaves install untouched, since the two namespaces drift apart", async () => {
    const before = JSON.parse(
      await readFile(join(cwd, ".taskless", "taskless.json"), "utf8")
    ) as { install?: unknown };
    await runCli(["update", "--rules", "-d", cwd]);
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
    // No marker recorded, so the walk starts at the baseline: absent means
    // the project predates the ledger and every entry still applies.
    expect(payload.walk).toEqual({ from: "0.0.0", to: payload.installed });
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

  it("tells an author what to DO about each semantics change", async () => {
    // The section used to say "re-run your fixtures and read the findings",
    // which tells someone to look without saying what for. Both shapes were
    // measured across the two binaries, so it can name the action instead.
    const result = await runCli(["update"]);

    // Shape 1: the rule was inert and now reports. Fixtures cannot catch it,
    // because a rule matching nothing passes its own `pass/` side.
    expect(result.stdout).toContain("silently dead and now fires");
    expect(result.stdout).toContain("read\nthem as new");

    // Shape 2: identical findings, different rendered output. Counting will
    // not surface it, so the instruction is to grep the rules.
    expect(result.stdout).toContain("will not change your finding counts");
    expect(result.stdout).toContain(
      "writing the\nleaked text into people's files"
    );

    // And the one we could not reproduce is named as such rather than
    // dressed up as guidance.
    expect(result.stdout).toContain(
      "no shape we tried reproduced a difference"
    );
  });

  it("carries the 0.11.0 ledger entry", async () => {
    const result = await runCli(["update"]);
    expect(result.stdout).toContain("Migrating to 0.11.x");
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
