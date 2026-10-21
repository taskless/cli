import { isCancel, log, select, text } from "@clack/prompts";

import {
  commitInstall,
  DEFAULT_COMMIT_MESSAGE,
} from "../../install/uncommitted";

/** What the person chose to do about the install's uncommitted files. */
export type CommitChoice = "default" | "custom" | "skip";

/**
 * Offer to commit what the install just wrote.
 *
 * Asked after the files are on disk, so a cancel here cannot undo the
 * install. It is read as "don't commit" rather than thrown as a
 * `WizardCancelled`, which would report a finished install as cancelled.
 */
export async function promptCommit(
  cwd: string,
  paths: readonly string[]
): Promise<CommitChoice> {
  const choice = await select<CommitChoice>({
    message:
      "Commit the Taskless files? Agents that work in worktrees won't see them until they're committed.",
    options: [
      {
        value: "default",
        label: "Commit these files",
        hint: DEFAULT_COMMIT_MESSAGE,
      },
      { value: "custom", label: "Write my own commit message" },
      { value: "skip", label: "Don't commit, I'll do this myself" },
    ],
  });
  if (isCancel(choice) || choice === "skip") return "skip";

  let message = DEFAULT_COMMIT_MESSAGE;
  if (choice === "custom") {
    const written = await text({
      message: "Commit message",
      validate: (value) =>
        value === undefined || value.trim() === ""
          ? "Enter a commit message."
          : undefined,
    });
    if (isCancel(written)) return "skip";
    message = written.trim();
  }

  const result = await commitInstall(cwd, paths, message);
  if (result.ok) {
    log.success(`Committed the Taskless files: ${message}`);
  } else {
    log.warn(
      `git could not commit the Taskless files:\n${result.error}\nCommit them yourself before you start your agent.`
    );
  }
  return choice;
}
