import type { EngineName } from "./layout";

/**
 * How a notice tells the user to put back an issued rule.
 *
 * The plan decides which answer is honest. When the acting organization's
 * `restoreRules` entitlement is exactly `false`, the service will refuse
 * `rule restore`, so suggesting it only sends the user to be told to use git.
 * They get the git steps directly instead. Unknown (whoami failed, no
 * entitlement sent, or no organization matched) keeps suggesting
 * `rule restore`, word for word as before: the service answers a restore on
 * its own, so a wrong guess costs one refused call, never a lost capability.
 *
 * This decides only what is suggested. Nothing here stops a user running
 * `rule restore`, which always asks the service.
 */

/** A rule a notice points at, and what putting it back is for. */
export interface RecoveryTarget {
  ruleId: string;
  /** The rule's engine, when known. Unknown widens the git pathspec. */
  engine?: EngineName;
  /** Completes "Run `…` to <purpose>", e.g. "put back the issued version". */
  purpose: string;
  /** A step after recovering, e.g. "delete .taskless/rules/vale/bar-2/". */
  afterwards?: string;
  /** What to do instead of recovering, e.g. "ignore this if …". */
  otherwise?: string;
}

/** Renders the sentence a notice ends with. */
export type Recovery = (target: RecoveryTarget) => string;

/**
 * The directory `git` should look at. Quoted when the engine is unknown, so
 * the shell passes the glob to git as a pathspec rather than expanding it.
 * The glob matches the rule's files, not its directory, because git matches
 * a glob against file paths: measured, a glob ending in the directory's slash
 * finds no commits in `git log`, while one ending in a file wildcard finds
 * them and works for `restore` too. An exact directory needs no glob.
 */
function ruleDirectory(ruleId: string, engine?: EngineName): string {
  return engine === undefined
    ? `'.taskless/rules/*/${ruleId}/*'`
    : `.taskless/rules/${engine}/${ruleId}/`;
}

/** The sentence for a plan known not to include rule recovery. */
function gitSteps({ ruleId, engine, afterwards, otherwise }: RecoveryTarget) {
  const directory = ruleDirectory(ruleId, engine);
  return (
    `Restoring rules is not included in your organization's plan, so recover ${ruleId} from git: ` +
    `\`git log -- ${directory}\` lists the commits that changed it, and ` +
    `\`git restore --source=<commit> -- ${directory}\` puts it back as of one of them.` +
    (afterwards === undefined ? "" : ` Then ${afterwards}.`) +
    (otherwise === undefined ? "" : ` Or ${otherwise}.`)
  );
}

/**
 * Build the recovery sentence for a plan. `restoreCommand` renders the
 * `rule restore` invocation, so this stays free of how the CLI was invoked.
 */
export function recoveryAdvice(
  restoreRules: boolean | undefined,
  restoreCommand: (ruleId: string) => string
): Recovery {
  if (restoreRules === false) return gitSteps;
  return ({ ruleId, purpose, afterwards, otherwise }) =>
    `Run \`${restoreCommand(ruleId)}\` to ${purpose}` +
    (afterwards === undefined ? "" : `, then ${afterwards}`) +
    (otherwise === undefined ? "" : `, or ${otherwise}`) +
    ".";
}
