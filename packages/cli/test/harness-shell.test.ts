import { describe, expect, it } from "vitest";

import { detectHarnessShell } from "../src/detect/harness-shell";

describe("detectHarnessShell", () => {
  it.each([
    [{ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" }, "Claude Code", "!"],
    [{ CLAUDECODE: "1" }, "Claude Code", "!"],
    [{ CURSOR_AGENT: "1" }, "Cursor", "/shell "],
    [{ OPENCODE: "1" }, "OpenCode", "!"],
    [{ CODEX_THREAD_ID: "abc" }, "Codex", "!"],
    [{ GEMINI_CLI: "1" }, "Gemini CLI", "!"],
    [{ AI_AGENT: "devin_3000_agent" }, "Devin", "!"],
  ])("recognizes %j", (env, name, prefix) => {
    expect(detectHarnessShell(env)).toMatchObject({ name, prefix });
  });

  it("does not offer `!` in a Claude Code surface without it", () => {
    expect(
      detectHarnessShell({
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
      })
    ).toBeUndefined();
  });

  it("says nothing about an agent it has no syntax for", () => {
    expect(detectHarnessShell({ AI_AGENT: "crush" })).toBeUndefined();
    expect(detectHarnessShell({})).toBeUndefined();
  });

  it("names Cursor's time limit", () => {
    expect(detectHarnessShell({ CURSOR_AGENT: "1" })?.caveat).toContain(
      "30 seconds"
    );
  });
});
