import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";

import { resolveAstGrepLanguage, type AstGrepLanguage } from "./capabilities";
import { buildPath, stripSgDeprecationBanner } from "./scan";

/**
 * Dumping a file's named-node AST with the pinned ast-grep, for `taskless ast`.
 *
 * ast-grep has no command that prints a file's tree. The closest it has is
 * `run --debug-query=ast`, which prints the tree of the PATTERN, so the file's
 * contents are handed over as the pattern. Measured at 0.51.1, that is exact
 * rather than approximate:
 *
 * - The dump is of the text as given. Positions are not shifted by leading
 *   blank lines or indentation, and a metavariable-shaped `$FOO` in PHP still
 *   prints as `variable_name`, so pattern preprocessing does not reach it.
 * - A file is almost never a valid single-node pattern, so ast-grep goes on to
 *   reject it ("Multiple AST nodes are detected") and exits 8. The dump is
 *   printed to stderr before that, so the exit code is not the signal: the
 *   `Debug AST:` block is.
 * - `ast` prints named nodes only. Every kind it shows is one `kind:` accepts,
 *   which is the point: the `cst` dump prints keywords the same way, and
 *   `kind: readonly` is a config error.
 *
 * The cost of going through argv is size. Linux caps one argument at 128 KiB
 * (`E2BIG`) and Windows a whole command line at 32 Ki characters, so a file
 * past that cannot be dumped this way, and {@link dumpAst} says so rather
 * than failing with a bare errno.
 *
 * The dump is ast-grep's own text format, parsed here. That is not the
 * "parse generated output" the code style guide forbids: the generator is a
 * vendored binary with no structured alternative, and the format is pinned by
 * `test/ast-command.test.ts` against the binary across languages.
 */

/** A position in the file: a 1-based line and a 0-based UTF-8 byte column. */
export interface AstPosition {
  line: number;
  column: number;
}

/** One named node of the tree. */
export interface AstNode {
  kind: string;
  /** The field this node fills in its parent, when the grammar names one. */
  field?: string;
  start: AstPosition;
  end: AstPosition;
  /** The node's source text, for a node with no named children. */
  text?: string;
  children: AstNode[];
}

/** An inclusive, 1-based line range. */
export interface LineRange {
  from: number;
  to: number;
}

export class AstDumpError extends Error {
  override name = "AstDumpError";
  constructor(
    message: string,
    readonly code: "INVALID_INPUT" | "SCAN_FAILED"
  ) {
    super(message);
  }
}

/**
 * Parse `--range`: `<line>` or `<from>:<to>`, 1-based and inclusive.
 * Returns undefined for anything else.
 */
export function parseLineRange(value: string): LineRange | undefined {
  const match = /^(\d+)(?::(\d+))?$/.exec(value.trim());
  if (match === null) return undefined;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from < 1 || to < from) return undefined;
  return { from, to };
}

interface SgRun {
  code: number | null;
  stderr: string;
}

/** Run ast-grep with `argv`, collecting stderr. Rejects when it cannot start. */
function runSg(binary: string, argv: string[], cwd: string): Promise<SgRun> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, argv, {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, PATH: buildPath() },
      });
    } catch (error) {
      // `E2BIG` and an argument holding a NUL are thrown synchronously, before
      // any process exists.
      reject(error as Error);
      return;
    }
    const decoder = new StringDecoder("utf8");
    const chunks: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(decoder.write(chunk));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      chunks.push(decoder.end());
      resolve({ code, stderr: chunks.join("") });
    });
  });
}

/**
 * The language ast-grep reads `file` as, asked of the binary rather than of a
 * table of extensions.
 *
 * A `scan` with `--inspect entity` names the language it settled on for every
 * file it reached, which is the same resolution `check` gets, since `check`
 * also leaves extension mapping to ast-grep. The probe rule is Rust and only
 * exists because `scan` needs one; the language is reported whether or not any
 * rule applies. It runs against an empty config of its own, because ast-grep
 * otherwise picks up an `sgconfig.yml` above `cwd`, and its `languageGlobs`
 * would be a mapping `check` does not use.
 *
 * Undefined when ast-grep does not recognize the extension: such a file is not
 * reported at all. Ignore rules are not a second cause: ast-grep applies
 * `.gitignore`, hidden-file and similar filters only to what it finds while
 * walking a directory, never to a path it is given, and the probe gives it one.
 */
export async function detectAstLanguage(
  binary: string,
  cwd: string,
  file: string
): Promise<AstGrepLanguage | undefined> {
  const configDirectory = await mkdtemp(join(tmpdir(), "tskl-ast-"));
  try {
    const config = join(configDirectory, "sgconfig.yml");
    await writeFile(config, "ruleDirs: []\n", "utf8");
    const { stderr } = await runSg(
      binary,
      [
        "scan",
        "--config",
        config,
        "--inline-rules",
        "id: taskless-ast-probe\nlanguage: Rust\nrule: { kind: source_file }\n",
        "--inspect",
        "entity",
        "--",
        file,
      ],
      cwd
    );
    return parseInspectedLanguage(stderr);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}

/** The `language=` of the first file entity in `--inspect entity` stderr. */
export function parseInspectedLanguage(
  stderr: string
): AstGrepLanguage | undefined {
  for (const line of stderr.split("\n")) {
    if (!line.startsWith("sg: entity|file|")) continue;
    const language = /: language=([^,\s]+),/.exec(line)?.[1];
    if (language !== undefined) return resolveAstGrepLanguage(language);
  }
  return undefined;
}

const DEBUG_HEADER = "Debug AST:";
const NODE_LINE =
  /^((?: {2})*)(?:([A-Za-z_]\w*): )?(\S+) \((\d+),(\d+)\)-\((\d+),(\d+)\)$/;

/**
 * Parse the block `--debug-query=ast` prints into a tree.
 *
 * Lines are `<indent><field>: <kind> (<row>,<col>)-(<row>,<col>)`, two spaces
 * of indent per depth, rows 0-based, ending at the first blank line. Rows are
 * shifted to 1-based lines here so they read like an editor's.
 *
 * Throws when the block is missing or a line does not have that shape, since
 * either means the binary is not the one this parser was measured against.
 */
export function parseDebugAst(stderr: string): AstNode {
  const lines = stderr.split(/\r?\n/);
  const header = lines.indexOf(DEBUG_HEADER);
  if (header === -1) {
    throw new AstDumpError(
      `ast-grep printed no AST${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
      "SCAN_FAILED"
    );
  }

  const stack: AstNode[] = [];
  let root: AstNode | undefined;
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === "") break;
    const match = NODE_LINE.exec(line);
    if (match === null) {
      throw new AstDumpError(
        `Unexpected line in ast-grep's AST dump: ${JSON.stringify(line)}`,
        "SCAN_FAILED"
      );
    }
    const [, indent = "", field, kind = "", sr, sc, er, ec] = match;
    const depth = indent.length / 2;
    const node: AstNode = {
      kind,
      ...(field === undefined ? {} : { field }),
      start: { line: Number(sr) + 1, column: Number(sc) },
      end: { line: Number(er) + 1, column: Number(ec) },
      children: [],
    };
    if (depth === 0) {
      if (root !== undefined) {
        throw new AstDumpError(
          "ast-grep's AST dump has more than one root",
          "SCAN_FAILED"
        );
      }
      root = node;
    } else {
      const parent = stack[depth - 1];
      if (parent === undefined) {
        throw new AstDumpError(
          `ast-grep's AST dump skips a level at ${JSON.stringify(line)}`,
          "SCAN_FAILED"
        );
      }
      parent.children.push(node);
    }
    stack.length = depth;
    stack.push(node);
  }
  if (root === undefined) {
    throw new AstDumpError("ast-grep's AST dump is empty", "SCAN_FAILED");
  }
  return root;
}

/** Fill `text` on every node with no named children, from the file's bytes. */
export function attachLeafText(node: AstNode, source: string): void {
  const bytes = Buffer.from(source, "utf8");
  const lineStarts = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === 0x0a) lineStarts.push(index + 1);
  }
  const offset = (position: AstPosition): number =>
    (lineStarts[position.line - 1] ?? bytes.length) + position.column;

  const visit = (current: AstNode): void => {
    if (current.children.length === 0) {
      current.text = bytes
        .subarray(offset(current.start), offset(current.end))
        .toString("utf8");
      return;
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
}

/**
 * The last line a node occupies. A node that ends at column 0 of a later line
 * ends with that line's newline, so it does not occupy the line itself.
 */
export function lastLine(node: AstNode): number {
  return node.end.column === 0 && node.end.line > node.start.line
    ? node.end.line - 1
    : node.end.line;
}

/**
 * The tree cut down to the nodes that touch `range`: every node whose lines
 * overlap it, so the enclosing nodes stay as context and everything on those
 * lines is shown. Undefined when the root itself does not touch it.
 */
export function filterByRange(
  node: AstNode,
  range: LineRange
): AstNode | undefined {
  if (node.start.line > range.to || lastLine(node) < range.from) {
    return undefined;
  }
  return {
    ...node,
    children: node.children
      .map((child) => filterByRange(child, range))
      .filter((child): child is AstNode => child !== undefined),
  };
}

/** How many `ERROR` nodes the tree holds: a file that did not parse cleanly. */
export function countErrorNodes(node: AstNode): number {
  return node.children.reduce(
    (total, child) => total + countErrorNodes(child),
    node.kind === "ERROR" ? 1 : 0
  );
}

const TEXT_PREVIEW_LENGTH = 60;

/** The tree as indented lines, one node per line. */
export function renderAst(node: AstNode, depth = 0): string[] {
  const position = `${String(node.start.line)}:${String(node.start.column)}-${String(node.end.line)}:${String(node.end.column)}`;
  const field = node.field === undefined ? "" : `${node.field}: `;
  let text = "";
  if (node.text !== undefined) {
    const preview =
      node.text.length > TEXT_PREVIEW_LENGTH
        ? `${node.text.slice(0, TEXT_PREVIEW_LENGTH)}…`
        : node.text;
    text = ` ${JSON.stringify(preview)}`;
  }
  return [
    `${"  ".repeat(depth)}${field}${node.kind} [${position}]${text}`,
    ...node.children.flatMap((child) => renderAst(child, depth + 1)),
  ];
}

/**
 * Dump `source`'s named-node tree as `language` parses it.
 *
 * `cwd` only sets where ast-grep runs; the source is handed over whole.
 */
export async function dumpAst(options: {
  binary: string;
  cwd: string;
  source: string;
  language: AstGrepLanguage;
}): Promise<AstNode> {
  const { binary, cwd, source, language } = options;
  let result: SgRun;
  try {
    result = await runSg(
      binary,
      [
        "run",
        "--debug-query=ast",
        "--lang",
        language,
        // `=` joins the value so a file starting with `-` (a YAML list) is not
        // read as a flag.
        `--pattern=${source}`,
        // Nothing to search: without this, a file that happens to be one valid
        // pattern would go on to scan the whole of `cwd` for matches.
        "--stdin",
      ],
      cwd
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "E2BIG" || code === "ENAMETOOLONG") {
      throw new AstDumpError(
        `The file is too large to dump (${String(Buffer.byteLength(source))} bytes): ast-grep receives it as a command-line argument, which this platform limits. Dump a smaller file, or copy the part you need into one.`,
        "INVALID_INPUT"
      );
    }
    if (code === "ERR_INVALID_ARG_VALUE") {
      throw new AstDumpError(
        "The file contains a NUL byte, so it is not source text ast-grep can parse.",
        "INVALID_INPUT"
      );
    }
    throw error;
  }
  return parseDebugAst(stripSgDeprecationBanner(result.stderr));
}
