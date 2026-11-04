import type { HarnessShell } from "../prompts/recipes";

/**
 * How a person runs a one-off command from inside the harness that started
 * this CLI, for wording an instruction. Only ever a suggestion: a harness that
 * is not recognized, or is recognized wrongly, still gets "another terminal".
 *
 * Read from a fixed table so that nothing from the environment reaches the
 * text an agent reads. Never use this to authorize anything: any process can
 * set these variables.
 */
const BANG = "!";

const HARNESS_SHELLS: ReadonlyArray<
  HarnessShell & {
    matches: (env: Record<string, string | undefined>) => boolean;
  }
> = [
  {
    // code.claude.com/docs/en/env-vars sets `CLAUDECODE`, and
    // code.claude.com/docs/en/vs-code lists no `!` shortcut in the extension,
    // so only the CLI entrypoint is offered it.
    name: "Claude Code",
    prefix: BANG,
    matches: (env) =>
      env.CLAUDECODE !== undefined &&
      (env.CLAUDE_CODE_ENTRYPOINT ?? "cli") === "cli",
  },
  {
    // cursor.com/docs/cli/shell-mode: 30 seconds, no interactive prompts.
    // cursor.com/docs/agent/terminal: `CURSOR_AGENT` marks an agent's shell.
    name: "Cursor",
    prefix: "/shell ",
    caveat: "`/shell` stops a command after 30 seconds",
    matches: (env) => env.CURSOR_AGENT !== undefined,
  },
  {
    // opencode.ai/docs/tui/, and `OPENCODE=1` from anomalyco/opencode#3843.
    name: "OpenCode",
    prefix: BANG,
    matches: (env) => env.OPENCODE !== undefined,
  },
  {
    // developers.openai.com/codex/cli/reference; the variable is set by
    // codex-rs/core/src/exec_env.rs and is not documented.
    name: "Codex",
    prefix: BANG,
    matches: (env) => env.CODEX_THREAD_ID !== undefined,
  },
  {
    // geminicli.com/docs/reference/commands/
    name: "Gemini CLI",
    prefix: BANG,
    matches: (env) => env.GEMINI_CLI !== undefined,
  },
  {
    // docs.devin.ai/cli/changelog/stable: `AI_AGENT=devin_<version>_agent`.
    name: "Devin",
    prefix: BANG,
    matches: (env) => env.AI_AGENT?.startsWith("devin_") === true,
  },
];

export function detectHarnessShell(
  env: Record<string, string | undefined>
): HarnessShell | undefined {
  const match = HARNESS_SHELLS.find((harness) => harness.matches(env));
  if (match === undefined) return undefined;
  const { name, prefix, caveat } = match;
  return { name, prefix, caveat };
}
