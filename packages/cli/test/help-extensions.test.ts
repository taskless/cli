import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
    const execError = error as {
      stdout: string;
      stderr: string;
      code: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code,
    };
  }
}

describe("taskless help (no args)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-help-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("prints the human slug", async () => {
    const result = await runCli(["help", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("For agents:");
    expect(result.stdout).toContain("For humans:");
  });

  it("prints the topic table including all expected topics", async () => {
    const result = await runCli(["help", "-d", cwd]);
    expect(result.stdout).toContain("Topics:");
    for (const topic of ["init", "info", "check", "auth", "rule"]) {
      expect(result.stdout).toContain(topic);
    }
  });

  it("mentions the --anonymous flag", async () => {
    const result = await runCli(["help", "-d", cwd]);
    expect(result.stdout).toContain("--anonymous");
  });

  it("lists the routing recipe topics under Authoring recipes", async () => {
    const result = await runCli(["help", "-d", cwd]);
    expect(result.stdout).toContain("Authoring recipes:");
    for (const topic of [
      "route",
      "existing",
      "static",
      "remote",
      "engine-selection",
    ]) {
      expect(result.stdout).toContain(topic);
    }
  });
});

describe("taskless help <routing topic>", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-help-routing-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it.each(["route", "existing", "static", "remote", "engine-selection"])(
    "resolves the %s recipe without an unknown-topic error",
    async (topic) => {
      const result = await runCli(["help", topic, "-d", cwd]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`# Topic: ${topic}`);
      expect(result.stdout).toContain("## Goal");
      expect(result.stderr).not.toContain("Unknown command");
    }
  );
});

describe("taskless help <topic>", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-help-topic-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns the canonical recipe for a known topic", async () => {
    const result = await runCli(["help", "rule", "create", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Topic: rule create");
    expect(result.stdout).toContain("## Goal");
    expect(result.stdout).toContain("## Steps");
  });

  it("interpolates %(CLI_VERSION)s in the recipe header", async () => {
    const result = await runCli(["help", "rule", "create", "-d", cwd]);
    // Should contain a version pattern, not the literal placeholder.
    // Guard against both the legacy mustache syntax and the current
    // sprintf-js named-arg syntax leaking through.
    expect(result.stdout).not.toContain("{{CLI_VERSION}}");
    expect(result.stdout).not.toContain("%(CLI_VERSION)s");
    expect(result.stdout).toMatch(/CLI v\d+\.\d+\.\d+/);
  });

  it("interpolates %(INPUT_SCHEMA)s for topics with a Zod input", async () => {
    const result = await runCli(["help", "rule", "create", "-d", cwd]);
    expect(result.stdout).not.toContain("{{INPUT_SCHEMA}}");
    expect(result.stdout).not.toContain("%(INPUT_SCHEMA)s");
    // Embedded schema includes the JSON Schema $schema URI
    expect(result.stdout).toContain('"$schema"');
    expect(result.stdout).toContain('"prompt"');
    expect(result.stdout).toContain('"successCases"');
  });

  it("renders %(PACKAGE_MANAGER_DLX)s as the agent-fill marker", async () => {
    const result = await runCli(["help", "ci", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    // Sprintf substitutes the placeholder; the agent-fill marker should
    // appear in its rendered <package-manager-dlx> form, never as the
    // raw sprintf placeholder.
    expect(result.stdout).not.toContain("%(PACKAGE_MANAGER_DLX)s");
    expect(result.stdout).not.toContain("{{PACKAGE_MANAGER_DLX}}");
    expect(result.stdout).toContain("<package-manager-dlx>");
  });

  it("exits 1 for an unknown topic", async () => {
    const result = await runCli(["help", "totally-unknown", "-d", cwd]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown command");
  });
});

describe("taskless help --anonymous (variant lookup)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-help-anon-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns the .anonymous variant when one exists (rule create)", async () => {
    const result = await runCli([
      "help",
      "rule",
      "create",
      "--anonymous",
      "-d",
      cwd,
    ]);
    expect(result.exitCode).toBe(0);
    // The anonymous recipe declares "(anonymous)" in its header
    expect(result.stdout).toContain("# Topic: rule create (anonymous)");
  });

  it("returns the .anonymous variant for rule improve", async () => {
    const result = await runCli([
      "help",
      "rule",
      "improve",
      "--anonymous",
      "-d",
      cwd,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Topic: rule improve (anonymous)");
  });

  it("falls back to the canonical recipe when no variant exists (check)", async () => {
    const canonical = await runCli(["help", "check", "-d", cwd]);
    const anonymous = await runCli(["help", "check", "--anonymous", "-d", cwd]);
    expect(anonymous.exitCode).toBe(0);
    // Same body — falls back to check.txt since no check.anonymous.txt
    expect(anonymous.stdout).toBe(canonical.stdout);
  });

  it("returns the canonical recipe when --anonymous is omitted", async () => {
    const result = await runCli(["help", "rule", "create", "-d", cwd]);
    expect(result.stdout).toContain("# Topic: rule create");
    expect(result.stdout).not.toContain("(anonymous)");
  });
});

describe("bare taskless (non-TTY) routes to help index", () => {
  it("prints the non-interactive preamble + topic index", async () => {
    // execFile gives no TTY, which triggers the routing. No flags so
    // citty doesn't try to forward them to the help subcommand.
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("non-interactive context detected");
    expect(result.stdout).toContain("Topics:");
  });
});

describe("taskless help engine-selection", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-help-engine-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("names all three engines and puts evidence before the answer", async () => {
    const result = await runCli(["help", "engine-selection", "-d", cwd]);
    expect(result.exitCode).toBe(0);
    for (const engine of ["`sg`", "`vale`", "`runtime`"]) {
      expect(result.stdout).toContain(engine);
    }
    expect(result.stdout).toContain("before naming an engine");
  });

  it("carries the three boundary cases", async () => {
    const result = await runCli(["help", "engine-selection", "-d", cwd]);
    // Each is a wrong answer someone actually reaches for.
    expect(result.stdout).toContain("Prose about code is still prose");
    expect(result.stdout).toContain("one document at a time");
    expect(result.stdout).toContain("Engine is not trust tier");
  });

  it("states the ambiguity default as a property, not as `sg`", async () => {
    const result = await runCli(["help", "engine-selection", "-d", cwd]);
    // D7: "choose an engine you know is available" stays correct on an
    // unsupported arch and server-side alike; naming `sg` outright would be
    // false on the host where `sg` is the missing one.
    expect(result.stdout).toContain("choose an engine you know is");
    expect(result.stdout).toContain("available");
  });

  it("stays out of the authoring-destination decision", async () => {
    const result = await runCli(["help", "engine-selection", "-d", cwd]);
    // Scope guard (3.4): it may point at `route`, never re-decide it.
    expect(result.stdout).toContain("is `route`, and it is a separate");
  });

  it("follows the recipe header and section convention", async () => {
    const result = await runCli(["help", "engine-selection", "-d", cwd]);
    expect(result.stdout).toContain("# Topic: engine-selection");
    for (const section of [
      "## Goal",
      "## Preconditions",
      "## Steps",
      "## See Also",
    ]) {
      expect(result.stdout).toContain(section);
    }
  });
});
