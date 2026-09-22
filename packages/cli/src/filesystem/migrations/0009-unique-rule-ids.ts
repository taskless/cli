import { join } from "node:path";

import {
  describeRuleIdCollision,
  findRuleIdCollisions,
  metadataSidecarPath,
  type RuleIdCollision,
} from "../../rules/id-uniqueness";
import { CLIError } from "../../util/cli-error";
import { buildInvocation } from "../../util/invocation";
import type { Migration } from "../types";

/**
 * Refuse a project where one rule id is held by more than one engine.
 *
 * `verify` now fails such a rule, but `verify` only reaches rules someone
 * runs it on. A project that already holds `sg/no-eval` beside `vale/no-eval`
 * would keep sharing one `rule-metadata/no-eval.yml` until someone happened to
 * look, and the sidecar is overwritten by whichever rule is written last, with
 * nothing reporting it. The upgrade is the one moment every existing project
 * passes through, so this is where they are all checked.
 *
 * DETECTS AND REFUSES. IT MUST NEVER RENAME. Nothing here can tell which of
 * the two rules should keep the id, and a rename is not local: the
 * `rule-metadata/{id}.yml` sidecar, the rule's `.tests/` fixtures and the
 * server-side id all reference the old name. An automatic rename would pick
 * one at random and break the references of whichever it moved.
 *
 * The message has to do more work than a migration's usually does, because of
 * where the user is standing when they read it. `check` and `verify` refuse a
 * stale scaffold with `SCAFFOLD_MIGRATION_REQUIRED`, which says to run `init`;
 * `init` is what runs this migration. So a refusal that only said "there is a
 * collision" would send the user back to `init`, which would refuse again. It
 * names the rename to perform BEFORE re-running `init`, which is what turns
 * the pair of messages into a path out rather than a loop.
 *
 * Idempotent, and read-only in every case. A project with no collision is
 * enumerated and nothing is written, so a second run touches nothing and
 * `git status` stays clean.
 */
const migration: Migration = async (directory) => {
  // The collision is a fact about `.taskless/rules/`, and every helper that
  // describes it takes the PROJECT root, which is this directory's parent.
  const cwd = join(directory, "..");
  const collisions = await findRuleIdCollisions(cwd);
  if (collisions.length === 0) return;
  throw new CLIError(
    collisions.map((collision) => refusal(cwd, collision)).join("\n\n"),
    // The same code `rules delete` reports for the same condition. An agent
    // that has learned what to do with one has learned what to do with both.
    "RULE_ID_AMBIGUOUS"
  );
};

/** One collision, and the rename that clears it. */
function refusal(cwd: string, collision: RuleIdCollision): string {
  return (
    `${describeRuleIdCollision(cwd, collision)}\n\n` +
    `Rename one of those directories before re-running ` +
    `\`${buildInvocation()} init\`, and rename with it: the rule file inside ` +
    `it, the rule's own \`id:\` field where its engine has one, and the ` +
    `sidecar at ${metadataSidecarPath(cwd, collision.ruleId)}. Nothing here ` +
    `can tell which rule should keep the id, so nothing is renamed for you.`
  );
}

export default migration;
