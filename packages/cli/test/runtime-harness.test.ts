import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverRuntimeRules } from "../src/rules/runtime/discover";
import { executeRuntimeRule } from "../src/rules/runtime/harness";

/** Build a capture `*.yml` with a `metadata.taskless` runtime block. */
function capture(options: {
  id: string;
  name: string;
  pattern: string;
  match?: "anchor" | "broad";
  rule?: string;
}): string {
  const ruleBlock = options.rule ?? `  pattern: ${options.pattern}`;
  return [
    `id: ${options.id}`,
    "language: typescript",
    "rule:",
    ruleBlock,
    "metadata:",
    "  taskless:",
    "    version: 1",
    "    kind: runtime",
    `    name: ${options.name}`,
    "    check: check.ts",
    `    match: ${options.match ?? "anchor"}`,
    "",
  ].join("\n");
}

/** Write a runtime rule directory (capture files + check.ts) under the repo. */
async function writeRuntimeRule(
  root: string,
  name: string,
  captures: Record<string, string>,
  check: string
): Promise<void> {
  const directory = join(root, ".taskless", "rules", "runtime", name);
  // Capture rules live in `captures/`; `check.ts` stays at the rule root.
  await mkdir(join(directory, "captures"), { recursive: true });
  for (const [file, body] of Object.entries(captures)) {
    await writeFile(join(directory, "captures", file), body, "utf8");
  }
  await writeFile(join(directory, "check.ts"), check, "utf8");
}

/** A check that echoes each match back as a finding (proves it was invoked). */
const ECHO_CHECK = `export default async function (root, matches) {
  return matches.map((m) => ({
    file: m.file,
    line: m.line,
    column: m.column,
    message: "rule=" + m.rule + " cap=" + JSON.stringify(m.captures),
    severity: "warning",
  }));
}
`;

/**
 * An unknown key under `metadata.taskless` does not drop the capture.
 *
 * The generator asked before depending on it, which is the right order, and
 * the honest answer was that it works by ACCIDENT rather than by design:
 * `assessCaptureRule` checks the fields it needs and never rejects the ones it
 * does not know, and ast-grep treats `metadata` as opaque. Neither is a
 * decision anybody wrote down, so neither is a promise until something holds
 * it.
 *
 * This holds it. The generator carries a demonstration disclaimer as
 * `metadata.taskless.note`, written INTO the rule rather than only into the
 * HTTP response, because a note in an envelope is gone the moment the rule
 * reaches disk — which is exactly when a reader with no memory of asking for a
 * demo needs to know what it is.
 *
 * The assertion is that the capture still MATCHES, not merely that discovery
 * accepted it. A capture that is dropped produces no findings, and no findings
 * is what a passing run looks like.
 */
describe("an unknown metadata.taskless key", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-unknown-meta-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const withNote = [
    "id: env-read-abc12345",
    "language: typescript",
    "rule:",
    "  pattern: process.env.$NAME",
    "metadata:",
    "  taskless:",
    "    version: 1",
    "    kind: runtime",
    "    name: env-read",
    "    check: check.ts",
    "    match: anchor",
    '    note: "Example rule. May not apply to this repository."',
    "",
  ].join("\n");

  it("is discovered, and its capture still matches", async () => {
    await writeRuntimeRule(
      cwd,
      "env-read",
      { "env.yml": withNote },
      ECHO_CHECK
    );
    await writeFile(
      join(cwd, "src.ts"),
      "const home = process.env.HOME;\n",
      "utf8"
    );

    const rules = await discoverRuntimeRules(cwd);
    expect(rules).toHaveLength(1);

    const findings = await executeRuntimeRule(cwd, rules[0]!);
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("runtime harness", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tskl-harness-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers a runtime rule directory", async () => {
    await writeRuntimeRule(
      root,
      "logs",
      {
        "logs.yml": capture({
          id: "logs-a1",
          name: "logs",
          pattern: "console.log($A)",
        }),
      },
      ECHO_CHECK
    );
    const rules = await discoverRuntimeRules(root);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.captureRules[0]!.name).toBe("logs");
    expect(rules[0]!.captureRules[0]!.match).toBe("anchor");
    expect(rules[0]!.checkFile.endsWith("check.ts")).toBe(true);
  });

  it("gates on matches: zero matches never invokes check.ts", async () => {
    // The source has no console.log, so the narrow yields nothing and the echo
    // check (which would return a finding per match) must never run.
    await writeFile(join(root, "src.ts"), "const x = 1;\n", "utf8");
    await writeRuntimeRule(
      root,
      "logs",
      {
        "logs.yml": capture({
          id: "logs-a1",
          name: "logs",
          pattern: "console.log($A)",
        }),
      },
      ECHO_CHECK
    );
    const [rule] = await discoverRuntimeRules(root);
    const results = await executeRuntimeRule(root, rule!);
    expect(results).toHaveLength(0);
  });

  it("normalizes matches (1-indexed, rule name, captures) and maps findings to 0-indexed range", async () => {
    await writeFile(
      join(root, "src.ts"),
      'const x = 1;\nconsole.log("hi");\n',
      "utf8"
    );
    await writeRuntimeRule(
      root,
      "logs",
      {
        "logs.yml": capture({
          id: "logs-a1",
          name: "logs",
          pattern: "console.log($A)",
        }),
      },
      ECHO_CHECK
    );
    const [rule] = await discoverRuntimeRules(root);
    const results = await executeRuntimeRule(root, rule!);
    expect(results).toHaveLength(1);
    const finding = results[0]!;
    expect(finding.source).toBe("taskless-runtime");
    expect(finding.ruleId).toBe("logs");
    expect(finding.file).toBe("src.ts");
    // The match is on line 2 (1-indexed); the echo check returns m.line, which
    // the harness converts down to the 0-indexed CheckResult range.
    expect(finding.range.start.line).toBe(1);
    expect(finding.message).toContain("rule=logs");
    // captures echoed through: the single metavariable A holds the string "hi".
    expect(finding.message).toContain("cap=");
    expect(finding.message).toContain("hi");
  });

  it("isolates a throwing check into a single error finding", async () => {
    await writeFile(join(root, "src.ts"), 'console.log("hi");\n', "utf8");
    await writeRuntimeRule(
      root,
      "boom",
      {
        "logs.yml": capture({
          id: "logs-a1",
          name: "logs",
          pattern: "console.log($A)",
        }),
      },
      `export default async function () { throw new Error("kaboom"); }\n`
    );
    const [rule] = await discoverRuntimeRules(root);
    const results = await executeRuntimeRule(root, rule!);
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("error");
    expect(results[0]!.message).toContain("boom");
  });

  it("times out a slow check into an error finding", async () => {
    await writeFile(join(root, "src.ts"), 'console.log("hi");\n', "utf8");
    await writeRuntimeRule(
      root,
      "slow",
      {
        "logs.yml": capture({
          id: "logs-a1",
          name: "logs",
          pattern: "console.log($A)",
        }),
      },
      `export default async function () {
        await new Promise((r) => setTimeout(r, 5000));
        return [];
      }\n`
    );
    const [rule] = await discoverRuntimeRules(root);
    const results = await executeRuntimeRule(root, rule!, { timeoutMs: 200 });
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe("error");
    expect(results[0]!.message).toContain("timed out");
  }, 15_000);
});
