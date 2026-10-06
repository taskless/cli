import { renderNoticeBox } from "./notice-box";

/**
 * The banner an upgrade owes a session that is already running.
 *
 * Installing rewrites files an AI tool has usually ALREADY READ. A coding agent
 * loads its skill and command listing once, when the session starts, so a
 * session open at install time keeps serving the previous copy for the rest of
 * its life. Nothing errors: the agent follows guidance one version out of date
 * and reports success.
 *
 * That is worse here than it would be for most tools, because a Taskless recipe
 * is embedded in the bundle at build time rather than fetched. A stale skill
 * names a stale CLI invocation, which serves a stale recipe, so the answer is
 * wrong rather than missing. An agent following a recipe from an older build
 * once authored four rules against a `language:` spelling the current build had
 * already documented as wrong, and nothing in the run looked unusual.
 *
 * The banner is loud on purpose. The failure it prevents is silent, arrives
 * later, and does not look like an install problem when it does.
 */

/** What this install did to the recorded version. */
export interface ReloadNoticeInput {
  /** The `install.cliVersion` recorded before this run, if there was one. */
  previousCliVersion?: string;
  /** The version this run recorded. */
  cliVersion: string;
}

/**
 * Whether this run changed the version, which is the only thing that makes an
 * open session stale.
 *
 * A first install is not an upgrade: there was no earlier skill for a running
 * session to be holding. Any move between two recorded versions counts,
 * including a downgrade and including a stable/nightly swap, since both leave
 * the same stale copy in memory.
 */
export function versionMoved(input: ReloadNoticeInput): boolean {
  return (
    input.previousCliVersion !== undefined &&
    input.previousCliVersion !== input.cliVersion
  );
}

/**
 * The banner, or `undefined` when this run did not move the version.
 *
 * Printed on the transition rather than on every install. A banner that shows
 * up on runs where nothing changed is one people learn to scroll past, which
 * would cost exactly the runs it exists for.
 */
export function getReloadNotice(input: ReloadNoticeInput): string | undefined {
  if (!versionMoved(input)) return undefined;

  return renderNoticeBox("RESTART YOUR AGENTS", [
    `Taskless changed from ${input.previousCliVersion ?? ""} to ${input.cliVersion}.`,
    "An AI session that is already open still holds the previous skills, " +
      "because most tools read the skill list once, at startup.",
    "Reload skills in your AI tool, or start a new session, before asking " +
      "it to use Taskless.",
  ]);
}
