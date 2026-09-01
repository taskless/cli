import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ensureTasklessDirectory } from "../../src/filesystem/directory";

/**
 * Bring a test fixture up to the current scaffold version before the CLI reads
 * it, the way a user now does.
 *
 * `check`, `verify` and `test` used to migrate on their way to doing their real
 * work, so a fixture written in the pre-`0004` layout was silently modernised
 * mid-command and every one of these suites depended on that without saying so.
 * Those commands refuse now, which is the point of the change: a command that
 * reports must not rewrite the repository, and a migration nobody watches is a
 * migration nobody can verify.
 *
 * So the migration moves into the fixture setup, where it is visible. These
 * suites are about what `check` and `verify` REPORT; the refusal itself has its
 * own tests, and putting it here too would only stop them testing their subject.
 *
 * Only migrates a project that already has a `.taskless/`. Creating one would
 * break the several tests whose subject is a project that has none.
 */
export async function migrateFixture(args: string[]): Promise<void> {
  const index = args.indexOf("-d");
  const cwd = index === -1 ? undefined : args[index + 1];
  if (cwd === undefined) return;
  try {
    await stat(join(cwd, ".taskless"));
  } catch {
    return;
  }
  await ensureTasklessDirectory(cwd, { onNotice: () => {} });
}
