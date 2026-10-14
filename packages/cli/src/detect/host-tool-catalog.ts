/**
 * The host tools Taskless looks for, and everything said about each one.
 *
 * ONE TABLE, because three surfaces describe these tools — `detect --json`'s
 * `hostTools`, its `agent` hints, and the onboard recipe's host-tool text —
 * and two descriptions of one tool drift. Adding a tool here is the whole
 * change: detection, applicability, the reason it does not apply, and the
 * command an agent may run to check it all come from its row.
 *
 * PURE DATA, NO NODE IMPORTS. The recipe renderer is published as
 * `@taskless/cli/prompts`, whose chunk graph may reach no node builtin, and it
 * is meant to read this table too.
 */

/** The forge an `origin` remote lives on, as far as host tools care. */
export type OriginForge = "github" | "gitlab" | "other" | "none";

export interface HostToolEntry {
  /** The command as it would be typed, e.g. `gh`. */
  name: string;
  /**
   * The forge this tool needs, or `undefined` for a tool that is useful in any
   * repository. A tool tied to a forge is inapplicable everywhere else,
   * however well it is installed.
   */
  forge?: "github" | "gitlab";
  /**
   * Why the tool is inapplicable, as a fragment that reads inside
   * parentheses. Stated as a property of the PROJECT, because that is the
   * part no install changes.
   */
  inapplicableReason?: string;
  /**
   * A command the agent MAY run to learn whether the tool can be used as a
   * source, and what it tells it. Detection never runs it; whether to is the
   * agent's call.
   */
  hint?: { command: string; meaning: string };
}

/**
 * Fixed order, so a rendering that lists the tools is stable across hosts and
 * two runs on one host cannot differ by ordering alone.
 */
export const HOST_TOOL_CATALOG: readonly HostToolEntry[] = [
  {
    name: "gh",
    forge: "github",
    inapplicableReason: "this repository has no GitHub origin",
    hint: {
      command: "gh auth status",
      meaning:
        "Verifies whether the user is signed in to GitHub, so pull requests and their review comments can be used as a source.",
    },
  },
  { name: "git" },
  { name: "jq" },
  {
    name: "glab",
    forge: "gitlab",
    inapplicableReason: "this repository has no GitLab origin",
    hint: {
      command: "glab auth status",
      meaning:
        "Verifies whether the user is signed in to GitLab, so merge requests and their review comments can be used as a source. Read the output, not the exit code: it can exit 0 while signed out (gitlab-org/cli#911).",
    },
  },
];
