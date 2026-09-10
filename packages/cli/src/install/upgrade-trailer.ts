import { versionMoved } from "./reload-notice";

/**
 * What a non-interactive install changed, in the terms an agent acts on.
 *
 * The install summary above this trailer says what was written. It does not
 * say that the writes landed in files under version control, or that a move
 * between two recorded CLI versions is the moment `update` exists for. An
 * agent that `check` sent to `init` reads the summary, sees success, and goes
 * back to `check`; the rewritten stubs are left for whoever commits next, and
 * the ledger walk never happens. This trailer names both obligations.
 */
export interface UpgradeTrailerInput {
  /** Target directories with at least one write or removal this run. */
  changedDirectories: string[];
  /** Whether a scaffold migration ran. */
  migrated: boolean;
  /** The `install.cliVersion` recorded before this run, if there was one. */
  previousCliVersion?: string;
  /** The version this run recorded. */
  cliVersion: string;
  /** The invocation to print in front of `update`, e.g. `npx @taskless/cli`. */
  invocation: string;
}

/**
 * The trailer, or `undefined` when this run changed nothing. A no-op
 * re-install has nothing to commit and nothing to reconcile, and printing a
 * trailer that says so would teach an agent to skim it.
 */
export function getUpgradeTrailer(
  input: UpgradeTrailerInput
): string | undefined {
  // `.taskless/` is also the canonical install target, so it is usually in the
  // list already. The set keeps a migration-only run from listing it twice. A
  // version move counts on its own: it rewrites `install.cliVersion` in
  // `.taskless/taskless.json`, which is a tracked file, even when no skill
  // bytes changed.
  const directories = new Set(input.changedDirectories);
  if (input.migrated || versionMoved(input)) directories.add(".taskless");
  if (directories.size === 0) return undefined;

  const listed = [...directories]
    .map((directory) => `${directory.replace(/\/$/, "")}/`)
    .join(", ");
  const lines = [
    `Taskless changed files under ${listed}. They belong in your next commit.`,
  ];

  if (versionMoved(input)) {
    lines.push(
      `The CLI moved from ${input.previousCliVersion ?? ""} to ${input.cliVersion}. ` +
        `Run \`${input.invocation} update\` to learn what that changes for the rules already in this project.`
    );
  }

  return lines.join("\n");
}
