import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { addToGitignore } from "../gitignore";
import type { Migration } from "../types";

/**
 * Create `.taskless/reports/`, where `taskless report` records each report it
 * publishes, and keep it out of git.
 *
 * Each record holds the delete URL tskl.es returns exactly once: the only way
 * to take down a page anyone with its link can view. Committed, it would hand
 * that to everyone who can read the repository, so the directory is ignored
 * whole rather than file by file.
 *
 * The stub says what the directory is for to someone who finds it, since a
 * directory that git ignores has no history to explain it. Written only when
 * absent, so a rerun never touches records or an edited stub.
 *
 * Anchored with a leading `/`, as `0007` anchors `/.tmp-*`: a rule directory is
 * free to hold something named `reports`.
 */
const STUB = `# Taskless reports

One JSON file per report \`taskless report\` published to tskl.es, holding
its link, when it expires, and the URL that deletes it.

This directory is gitignored: the delete URL is the only way to take a
report down early, and anyone holding it can. Delete a report with
\`taskless report --delete <file>\`.
`;

const migration: Migration = async (directory) => {
  const reports = join(directory, "reports");
  await mkdir(reports, { recursive: true });
  await writeFile(join(reports, "README.md"), STUB, {
    encoding: "utf8",
    flag: "wx",
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  // `addToGitignore` takes the project root and appends `.taskless` itself.
  await addToGitignore(dirname(directory), ["/reports/"]);
};

export default migration;
