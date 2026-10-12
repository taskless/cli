import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline";

import { parse } from "yaml";

import { ruleFilePath } from "./engines";
import { buildPath, findSgBinary, sgWalkArgv } from "./scan";

/**
 * Whether an ast-grep rule's `files:`/`ignores:` globs reach any file in the
 * project.
 *
 * `test` cannot answer this from the fixtures. An sg fixture is a `valid:` or
 * `invalid:` snippet with no path, so the globs never apply to it, and a rule
 * whose `files:` names `lib/**` in a project that keeps its code in `src/`
 * passes every test and is then never run by `check` (#486). A typo in a glob
 * and a clean codebase look exactly the same from either command.
 *
 * ## Why ast-grep answers, not a glob library
 *
 * The question is what ast-grep's walker would hand this rule, which depends on
 * its glob dialect, the `ignore` crate's `.gitignore` handling, and the walk
 * flags `check` passes. Re-deriving that with a second matcher is a second
 * opinion that can disagree with the first. `--inspect entity` reports it
 * directly, per file, on stderr. Measured against the vendored 0.45.3:
 *
 * ```
 * sg: entity|file|src/app.ts: language=TypeScript,appliedRuleCount=0
 * ```
 *
 * `appliedRuleCount` is the number of loaded rules whose language, `files:` and
 * `ignores:` all admit the file. With `-r` exactly one rule is loaded, so any
 * line above zero means the rule is in scope somewhere.
 *
 * `-r` rather than the assembled config for the reason
 * `sg-fixture-findings.ts` gives: one malformed sibling rule aborts parsing of
 * the assembled config, and the scope of THIS rule would then read as zero.
 * With no project config, ast-grep resolves the globs against the cwd, which is
 * the project root `check` scans from. `sgWalkArgv([])` is the whole-project
 * walk `check` performs, so the files considered here are the files `check`
 * considers.
 */

/** One `--inspect entity` file line, as ast-grep 0.45.3 writes it. */
const FILE_ENTITY = /^sg: entity\|file\|.*,appliedRuleCount=(\d+)$/;

/**
 * Which scoping keys the rule declares, or none when it declares neither.
 *
 * A rule with neither key is scoped only by `language:`, and reaching no file
 * then means the project has no code in that language, which `check` reporting
 * nothing is an honest account of. The defect is a glob that selects nothing,
 * so only a rule that has a glob is measured, and only that rule pays for the
 * walk.
 */
async function scopingKeys(ruleFile: string): Promise<string[]> {
  let rule: unknown;
  try {
    rule = parse(await readFile(ruleFile, "utf8")) as unknown;
  } catch {
    // An unreadable or malformed rule is `validate`'s to report.
    return [];
  }
  if (typeof rule !== "object" || rule === null) return [];
  return ["files", "ignores"].filter((key) => key in rule);
}

/**
 * Whether ast-grep applies the rule to at least one file in the project.
 *
 * Three answers, because a walk that did not finish is neither: `unknown` is
 * what lets the caller stay silent rather than report an empty scope it never
 * measured.
 *
 * Stops at the first file in scope: the answer is a yes/no, and the rest of the
 * walk, including running the rule over every file, would only confirm it.
 */
function reachesAnyFile(
  cwd: string,
  ruleFile: string
): Promise<"reached" | "empty" | "unknown"> {
  const sgBinary = findSgBinary();
  return new Promise((resolve) => {
    const child = spawn(
      sgBinary,
      [
        "scan",
        "-r",
        ruleFile,
        "--json=stream",
        "--inspect",
        "entity",
        ...sgWalkArgv([]),
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: buildPath() },
      }
    );

    let reached = false;
    // Findings arrive on stdout and are not this question. Drained so a full
    // pipe cannot block the child before it reaches the line we are waiting
    // for.
    child.stdout.resume();
    const rl = createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      const match = FILE_ENTITY.exec(line);
      if (match !== null && Number(match[1]) > 0 && !reached) {
        reached = true;
        child.kill();
      }
    });

    child.on("error", () => {
      resolve("unknown");
    });
    child.on("close", (code) => {
      if (reached) {
        resolve("reached");
        return;
      }
      // 0 is a clean scan and 1 is error-severity findings; anything else is a
      // walk that did not finish, and "no file seen" from it is not evidence
      // of an empty scope.
      resolve(code === 0 || code === 1 ? "empty" : "unknown");
    });
  });
}

/**
 * A notice when the rule's globs select no file in the project, or `undefined`.
 *
 * A notice rather than a failure. A glob can be narrow on purpose, written
 * ahead of the code it targets, and nothing about the rule itself is invalid.
 * What must not happen is the rule reading as tested and working while `check`
 * never runs it, and a notice is printed beside the tick, which is where that
 * reading forms.
 *
 * Silent when ast-grep could not finish the walk: saying the scope is empty on
 * the strength of a failed scan would be the same false clean this exists to
 * remove, in the other direction.
 */
export async function describeEmptySgScope(
  cwd: string,
  ruleId: string
): Promise<string | undefined> {
  const ruleFile = ruleFilePath(cwd, "sg", ruleId);
  const keys = await scopingKeys(ruleFile);
  if (keys.length === 0) return undefined;
  if ((await reachesAnyFile(cwd, ruleFile)) !== "empty") return undefined;
  const globs = keys.map((key) => `${key}:`).join("/");
  return (
    `${ruleId}'s ${globs} globs match no file in this project, so \`check\` ` +
    `will never run it. The globs are matched against paths relative to the ` +
    `project root; the fixtures passing does not exercise them.`
  );
}
