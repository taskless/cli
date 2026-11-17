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

  await commitWithRetry(cwd, paths, message);
  return choice;
}

/** What to do after a commit that did not go through. */
type AfterFailure = "retry" | "skip-hooks" | "leave";

/**
 * Run the commit, and when it does not go through, ask what to do instead of
 * giving up. A hook that refuses or hangs is the usual reason, so committing
 * without hooks is offered, but only here and only as the person's choice:
 * hooks are the project's rules, and the wizard never waives them on its own.
 */
async function commitWithRetry(
  cwd: string,
  paths: readonly string[],
  message: string
): Promise<void> {
  let skipHooks = false;
  for (;;) {
    // Said before git starts, because nothing else from the wizard is on
    // screen while a slow hook runs.
    log.info(
      skipHooks
        ? "Committing without running your git hooks."
        : "Committing. Your git hooks run now, in this terminal. Press Ctrl-C to stop the commit; the install stays in place."
    );
    const result = await commitInstall(cwd, paths, message, { skipHooks });
    if (result.ok) {
      log.success(`Committed the Taskless files: ${message}`);
      return;
    }

    const reason = result.interrupted
      ? "The commit was stopped."
      : result.error === undefined
        ? "git could not commit the Taskless files. Its output is above."
        : `git could not commit the Taskless files:\n${result.error}`;
    const options: { value: AfterFailure; label: string; hint?: string }[] = [
      { value: "retry", label: "Try again" },
    ];
    if (!skipHooks) {
      options.push({
        value: "skip-hooks",
        label: "Commit without running git hooks",
        hint: "git commit --no-verify",
      });
    }
    options.push({ value: "leave", label: "Leave it, I'll commit myself" });

    const next = await select<AfterFailure>({
      message: `${reason} What now?`,
      options,
    });
    if (isCancel(next) || next === "leave") {
      log.warn(
        "Commit the Taskless files yourself before you start your agent."
      );
      return;
    }
    if (next === "skip-hooks") skipHooks = true;
  }
}
