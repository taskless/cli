import { dirname } from "node:path";

import { addToGitignore } from "../gitignore";
import type { Migration } from "../types";

/**
 * Ignore the scratch request files agent recipes write under `.taskless/`.
 *
 * `create-remote-rule` writes `.tmp-rule-request.json`, `improve-rule` writes
 * `.tmp-improve-request.json`, and the feedback recipe writes
 * `.tmp-feedback.json`. Each recipe ends with a clean-up step, and an agent
 * that skips it leaves a file that `git status` then offers for commit. The
 * ignore makes a forgotten scratch file a stray rather than a commit.
 *
 * A migration rather than an edit to `0001`, which also writes this file. A
 * shipped migration is frozen: `runMigrations` runs only the migrations above
 * the recorded version, so a change to `0001` reaches new scaffolds and never
 * the projects that already exist, which is most of them. A fresh scaffold
 * runs `1` through `7` in order and ends with the same file an upgraded one
 * has.
 *
 * Anchored with a leading `/` for the reason `0001` anchors `/sgconfig.yml`:
 * an unanchored `.tmp-*` would match at any depth, and a rule directory is
 * free to carry a file by that name.
 */
const migration: Migration = async (directory) => {
  // `addToGitignore` takes the project root and appends `.taskless` itself.
  await addToGitignore(dirname(directory), ["/.tmp-*"]);
};

export default migration;
