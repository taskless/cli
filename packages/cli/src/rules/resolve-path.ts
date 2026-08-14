import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  ENGINES,
  isKnownEngine,
  listRuleIds,
  rulesRoot,
  type EngineName,
} from "./engines";

/** One rule a command was asked to act on. */
export interface ResolvedRule {
  engine: EngineName;
  ruleId: string;
}

/**
 * Turn a path into the rules it names.
 *
 * The engine comes from the path's `<engine>` segment under `.taskless/rules/`
 * — never from the file's contents, which is the rule `dispatch` already
 * follows, so a rule cannot be validated by one engine and executed by another.
 *
 * A path may name a rule directory, an engine directory, the rules root, or the
 * project root, and each means "every rule at or beneath here". That is what
 * makes `verify .taskless/` the CI form and `verify <rule>` the authoring form
 * without two argument shapes.
 *
 * An id would not do this job. The same id can exist under two engines, so an
 * id-addressed command has to either guess or report an ambiguity; a path has
 * neither problem, and removing the addressing scheme removed the error case.
 */
export async function resolveRulePath(
  cwd: string,
  target: string
): Promise<ResolvedRule[]> {
  const absolute = resolve(cwd, target);
  const root = rulesRoot(cwd);

  // At or above the rules root: every rule, every engine.
  const fromRoot = relative(root, absolute);
  const insideRoot = fromRoot !== "" && !fromRoot.startsWith("..");
  if (!insideRoot) {
    const relativeToProject = relative(absolute, root);
    const rootIsBeneath =
      relativeToProject === "" || !relativeToProject.startsWith("..");
    if (!rootIsBeneath) {
      throw new PathOutsideRulesError(target);
    }
    return allRules(cwd);
  }

  const [engine, ruleId, ...rest] = fromRoot.split(sep);
  if (engine === undefined || !isKnownEngine(engine)) {
    throw new PathOutsideRulesError(target);
  }

  // `.taskless/rules/<engine>` — every rule of that engine.
  if (ruleId === undefined) {
    const ids = await listRuleIds(cwd, engine);
    return ids.map((id) => ({ engine, ruleId: id }));
  }

  // Deeper than a rule directory (a file inside one) still names that rule:
  // pointing at `<rule>/<rule>.yml` should verify the rule, not fail.
  if (rest.length > 0) {
    return [{ engine, ruleId }];
  }

  // A rule directory, or a stray file where one would be.
  const stats = await statOrUndefined(absolute);
  if (stats === undefined) throw new RuleNotFoundError(target);
  if (!stats.isDirectory()) return [{ engine, ruleId }];
  return [{ engine, ruleId }];
}

/** Every rule in the project, engine by engine, ids sorted within each. */
async function allRules(cwd: string): Promise<ResolvedRule[]> {
  const rules: ResolvedRule[] = [];
  for (const engine of ENGINES) {
    for (const ruleId of await listRuleIds(cwd, engine)) {
      rules.push({ engine, ruleId });
    }
  }
  return rules;
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

/** A path that names no engine — the command cannot guess one. */
export class PathOutsideRulesError extends Error {
  constructor(public readonly target: string) {
    super(
      `"${target}" is not inside .taskless/rules/, so there is no engine to resolve it against. ` +
        `Pass a rule directory, an engine directory, or .taskless/rules/ for everything.`
    );
    this.name = "PathOutsideRulesError";
  }
}

/** A path under a known engine that does not exist on disk. */
export class RuleNotFoundError extends Error {
  constructor(public readonly target: string) {
    super(`No rule found at "${target}".`);
    this.name = "RuleNotFoundError";
  }
}
