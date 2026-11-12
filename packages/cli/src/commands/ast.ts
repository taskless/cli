import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { defineCommand } from "citty";

import {
  AstDumpError,
  attachLeafText,
  countErrorNodes,
  detectAstLanguage,
  dumpAst,
  filterByRange,
  lastLine,
  parseLineRange,
  renderAst,
  type LineRange,
} from "../rules/ast-dump";
import {
  astGrepLanguageList,
  resolveAstGrepLanguage,
  type AstGrepLanguage,
} from "../rules/capabilities";
import { findSgBinary } from "../rules/scan";
import { outputSchema as astOutputSchema } from "../schemas/ast";
import { writeJsonError, type CLIErrorCode } from "../types/errors";

/** A failure this command reports itself, with the code `--json` carries. */
class AstCommandError extends Error {
  constructor(
    message: string,
    readonly code: CLIErrorCode
  ) {
    super(message);
  }
}

/**
 * Decoding is strict: a lenient `"utf8"` read would turn every invalid byte
 * into U+FFFD, and the dump would then show a tree of text the file does not
 * hold, with nothing to say so. `ignoreBOM` keeps a byte-order mark in the
 * string, so byte columns still count from the file's first byte.
 */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function readSource(path: string, given: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new AstCommandError(
      code === "ENOENT"
        ? `No such file: ${given}`
        : code === "EISDIR"
          ? `${given} is a directory. \`ast\` takes one file.`
          : `Could not read ${given}: ${(error as Error).message}`,
      "INVALID_INPUT"
    );
  }
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new AstCommandError(
      `${given} is not valid UTF-8. ast-grep parses UTF-8 text, so re-encode the file (or a copy) as UTF-8 first.`,
      "INVALID_INPUT"
    );
  }
}

function resolveRange(value: string | undefined): LineRange | undefined {
  if (value === undefined) return undefined;
  const range = parseLineRange(value);
  if (range === undefined) {
    throw new AstCommandError(
      `--range takes <line> or <from>:<to>, 1-based with from <= to; got ${JSON.stringify(value)}.`,
      "INVALID_INPUT"
    );
  }
  return range;
}

function resolveLanguageOverride(
  value: string | undefined
): AstGrepLanguage | undefined {
  if (value === undefined) return undefined;
  const language = resolveAstGrepLanguage(value);
  if (language === undefined) {
    throw new AstCommandError(
      `ast-grep has no language ${JSON.stringify(value)}. Use one of: ${astGrepLanguageList()}.`,
      "INVALID_INPUT"
    );
  }
  return language;
}

function requireSgBinary(): string {
  try {
    return findSgBinary();
  } catch (error) {
    throw new AstCommandError((error as Error).message, "ENGINE_UNAVAILABLE");
  }
}

export const astCommand = defineCommand({
  meta: {
    name: "ast",
    description:
      "Print a file's named-node AST as the bundled ast-grep parses it, to find the kinds a rule can name",
  },
  args: {
    file: {
      type: "positional",
      description: "The file to parse",
      required: true,
    },
    lang: {
      type: "string",
      description:
        "Parse as this ast-grep language instead of the one the file's extension resolves to",
    },
    range: {
      type: "string",
      description:
        "Show only the nodes on these lines: <line> or <from>:<to>, 1-based and inclusive",
    },
    dir: {
      type: "string",
      alias: "d",
      description: "Working directory",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = resolve(args.dir ?? process.cwd());
    // ast reads one file and writes nothing, so it emits no bespoke event; the
    // per-invocation cli_run the runner emits covers it, as it does detect.
    try {
      const range = resolveRange(args.range);
      const override = resolveLanguageOverride(args.lang);

      const source = await readSource(resolve(cwd, args.file), args.file);
      if (source.length === 0) {
        throw new AstCommandError(
          `${args.file} is empty, so it has no AST to show.`,
          "INVALID_INPUT"
        );
      }

      const binary = requireSgBinary();
      const language =
        override ?? (await detectAstLanguage(binary, cwd, args.file));
      if (language === undefined) {
        throw new AstCommandError(
          `ast-grep does not recognize the extension of ${args.file}, so \`check\` does not scan it either. Pass --lang with one of: ${astGrepLanguageList()}.`,
          "INVALID_INPUT"
        );
      }

      const tree = await dumpAst({ binary, cwd, source, language });
      attachLeafText(tree, source);
      const errorNodes = countErrorNodes(tree);
      const root = range === undefined ? tree : filterByRange(tree, range);
      if (root === undefined) {
        throw new AstCommandError(
          `No node touches --range ${args.range ?? ""}: the tree of ${args.file} spans lines ${String(tree.start.line)} to ${String(lastLine(tree))}.`,
          "INVALID_INPUT"
        );
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            astOutputSchema.parse({
              ok: true,
              file: args.file,
              language,
              ...(range === undefined ? {} : { range }),
              errorNodes,
              root,
            })
          )
        );
        return;
      }

      console.log(
        `${args.file} as ${language}. Named nodes only, so every kind below is valid in \`kind:\`.`
      );
      console.log(
        "Positions are line:column, with 1-based lines and 0-based byte columns.\n"
      );
      for (const line of renderAst(root)) console.log(line);
      if (errorNodes > 0) {
        console.log(
          `\n${String(errorNodes)} ERROR node(s): the file does not parse cleanly as ${language}. If that is the wrong parser, pass --lang.`
        );
      }
    } catch (error) {
      if (error instanceof AstCommandError || error instanceof AstDumpError) {
        if (args.json) {
          writeJsonError(error.code, error.message);
        } else {
          console.error(`Error: ${error.message}`);
        }
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  },
});
