import { spawn } from "node:child_process";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

import { ruleFilePath } from "./engines";
import { buildPath, findSgBinary } from "./scan";

/**
 * Whether the vendored ast-grep will load one `sg` rule, asked of that rule
 * alone.
 *
 * The schema cannot decide everything the engine refuses. Which `kind` names
 * are valid depends on the grammar, and the binary has no way to list them: a
 * keyword token (`readonly`) or a Markdown inline construct (`link`) passes the
 * vendored JSON Schema and is then refused at load. Only the engine can say, so
 * this asks it.
 *
 * `scan -r <file> --stdin` with nothing on stdin loads exactly one rule and
 * scans nothing. No project config is assembled, so no other rule is parsed and
 * the error can only belong to this one. Measured on ast-grep 0.45.3:
 *
 * | rule                                   | exit | last line of the cause chain                          |
 * | -------------------------------------- | ---- | ----------------------------------------------------- |
 * | valid                                  | 0    |                                                       |
 * | `kind: readonly` (TypeScript)          | 8    | Kind `readonly` is invalid.                           |
 * | `kind: link` (Markdown)                | 8    | Kind `link` is invalid.                               |
 * | `language: Klingon`                    | 8    | data did not match any variant of untagged enum SgLang |
 * | `pattern: "foo("`                      | 8    | Rule must specify a set of AST kinds to match. ...    |
 * | `regex: "(["`                          | 8    | regex parse error: (then, on later lines) unclosed character class |
 * | top-level `strictness: ast`            | 0    | (accepted and ignored; see `sg-no-top-level-strictness`) |
 *
 * Ten calls take about 30 ms together, so one per rule costs nothing a person
 * would notice.
 *
 * Resolves to `undefined` when the rule loads, and otherwise to the message to
 * report under it.
 */
export async function parseSgRuleAlone(
  cwd: string,
  ruleId: string
): Promise<string | undefined> {
  const sgBinary = findSgBinary();
  return new Promise((resolve) => {
    const child = spawn(
      sgBinary,
      [
        "scan",
        "-r",
        ruleFilePath(cwd, "sg", ruleId),
        "--stdin",
        "--json=stream",
      ],
      {
        cwd,
        stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, PATH: buildPath() },
      }
    );

    // One decoder for the stream, for the reason `runTests` gives: a
    // multi-byte sequence split across chunks must not become two U+FFFDs.
    const decoder = new StringDecoder("utf8");
    const chunks: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(decoder.write(chunk));
    });

    child.on("error", () => {
      resolve("ast-grep (sg) binary not found. Is @ast-grep/cli installed?");
    });
    child.on("close", (code) => {
      chunks.push(decoder.end());
      const refusal =
        code === 0 ? undefined : describeRefusal(chunks.join(""), code);
      resolve(refusal);
    });

    child.stdin.on("error", () => {
      // A rule ast-grep refuses can close stdin before it is ended. The exit
      // code above is the verdict; this is not a second one.
    });
    child.stdin.end();
  });
}

/**
 * The message for a rule ast-grep would not load.
 *
 * ast-grep prints a generic header ("Cannot parse rule <path>") and then a
 * `Caused by` chain from the general to the specific. The last link is the one
 * an author can act on, so it leads; the rest follow as context. The header is
 * dropped because it names the file by the path this module passed, which says
 * nothing the rule's own entry in the report does not already say.
 */
function describeRefusal(stderr: string, code: number | null): string {
  // A link can run on past its own line: a regex error prints the pattern, a
  // caret, and `error: <what is wrong>` beneath `regex parse error:`. The last
  // of those lines is the specific part, so it is folded into its link.
  const causes: string[] = [];
  for (const raw of stripVTControlCharacters(stderr).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("╰▻")) {
      causes.push(line.replace(/^╰▻\s*/, ""));
    } else if (causes.length > 0 && line.startsWith("error:")) {
      const last = causes.length - 1;
      causes[last] = `${causes[last] ?? ""} ${line.replace(/^error:\s*/, "")}`;
    }
  }

  const consequence =
    "`check` loads every sg rule into one config, so until this is fixed it reports no sg findings for the project at all.";

  if (causes.length === 0) {
    const firstLine = stripVTControlCharacters(stderr)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "");
    return `ast-grep refuses this rule (exit ${String(code)})${firstLine === undefined ? "" : `: ${firstLine}`}. ${consequence}`;
  }

  const specific = causes.at(-1) ?? "";
  const context = causes.slice(0, -1);
  return (
    `ast-grep refuses this rule: ${specific}` +
    (context.length > 0 ? ` (${context.join(" › ")})` : "") +
    ` ${consequence}`
  );
}
