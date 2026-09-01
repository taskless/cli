import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { pinnedSpecifier } from "../../util/package-manager";
import { buildReadmeContent } from "./0001-init";
import type { Migration } from "../types";

/**
 * Rewrite `.taskless/README.md`, because the copy on disk describes a tree that
 * two migrations ago stopped existing.
 *
 * `0001` writes this file and says it "overwrites stale content from older
 * versions", which is true and not sufficient: `runMigrations` only runs
 * migrations ABOVE the recorded version, so a project already at 5 never runs
 * `0001` again. Its README is frozen at whatever the CLI wrote when it last
 * migrated, and for every project that reached 5 that text describes
 * `sg/rules/` and `sg/rule-tests/` — a layout `0004` and `0005` dismantled, and
 * a `rule-tests/` directory `0005` deletes outright.
 *
 * So the fix has to be a migration of its own. Correcting `0001`'s template
 * reaches new installs and projects still catching up; nothing but a version
 * bump reaches a project that is already current, which is most of them.
 *
 * A schema version spent on documentation is worth stating plainly rather than
 * apologising for. The file is generated, not authored — `0001` overwrites it
 * unconditionally and the header says "managed by Taskless" — so no user
 * content is at risk, and the alternative is a wrong description of the
 * project's own directory that never self-corrects.
 */
const migration: Migration = async (directory) => {
  await writeFile(
    join(directory, "README.md"),
    buildReadmeContent(pinnedSpecifier()),
    "utf8"
  );
};

export default migration;
