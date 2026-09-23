import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline";
import { join, posix, relative, sep } from "node:path";

import { parseDocument } from "yaml";
import type { Scalar, YAMLSeq } from "yaml";

import { ruleFilePath, ruleTestsDirectory } from "./engines";
import {
  bucketEntries,
  type FixtureBucket,
  type FixtureFinding,
} from "./fixtures";
import { buildPath, findSgBinary } from "./scan";
import { toCheckResult, type AstGrepMatch } from "../types/check";

/**
 * The findings an ast-grep rule's own fixtures produce, with their rendered
 * messages.
 *
 * `test` could previously only say whether the `invalid:` cases fired and the
 * `valid:` ones stayed quiet. A rule whose `message` interpolates its
 * metavariables can have the slots in the wrong order, fire in exactly the
 * right places, and be reported as a rule that passed — the rendered message is
 * the only evidence otherwise, and it was being thrown away.
 *
 * ## Why this does not go through `sg test`
 *
 * `sg test` is what decides the verdict, and it cannot produce a finding.
 * Measured against the vendored 0.45.3 binary, `ast-grep test --help` offers
 * `--filter`, `--skip-snapshot-tests`, `--update-all`, `--interactive`,
 * `--include-off`, `--color` and nothing else: there is no `--json` and no
 * output-format flag of any kind. Its only machine-readable output is the
 * `test result: ok. N passed; N failed;` line `parseTestSummary` already reads.
 *
 * ## Why this does not write temp files
 *
 * The obvious route was to materialise each snippet as a file and scan it,
 * which needs a `language:` → file-extension mapping the CLI does not own and
 * could not source reliably — `language:` takes ast-grep's own spelling
 * (`Yaml`, not `yaml`), the set is the binary's rather than ours, and a mapping
 * that drifted would silently scan a snippet as the wrong language.
 *
 * `scan --stdin` removes the whole question. Measured on 0.45.3:
 *
 * ```
 * printf 'console.log("hi");' | ast-grep scan -r rule.yml --stdin --json=stream
 * {"text":"console.log(\"hi\")",…,"file":"STDIN","language":"TypeScript",
 *  "message":"avoid log on console in ",…}
 * ```
 *
 * The language comes from the rule's own `language:` key, parsed by ast-grep
 * itself, so there is no mapping to keep in step and no extension to guess. No
 * file is written, so nothing can be left behind in the project tree, nothing
 * needs cleaning up on a failure, and no later `check` can pick up a stray.
 *
 * Two further properties were measured rather than assumed:
 *
 * - **`files:` globs do not suppress a stdin scan.** `ci-uses-workspace-cli`
 *   restricts itself to `.github/workflows/*.yml`, and the rule fires on the
 *   same snippet identically with and without that key — `files:` filters the
 *   file WALK, which stdin bypasses. A rule scoped to paths would otherwise
 *   have reported no findings at all, since the stdin document is named
 *   `STDIN`.
 * - **`-r` isolates a malformed rule.** A `language:` ast-grep does not
 *   recognise makes it exit 8 with `Fail to parse yaml as RuleConfig` and emit
 *   no JSON. Because `-r` loads exactly one rule file rather than the
 *   assembled config, that failure cannot take down any other rule's report —
 *   which is precisely the silent, config-wide abort the assembled-config path
 *   is vulnerable to. Here it degrades to no findings for the one rule.
 */

/**
 * ast-grep's exit code for a rule file it could not parse.
 *
 * Distinguished from `0`/`1` (clean scan / error-severity matches found) so an
 * unparseable rule degrades to no findings rather than being mistaken for a
 * rule that simply matched nothing.
 */
const SG_RULE_PARSE_FAILURE = 8;

/** Compare and report paths in the shape the other engines report them. */
function toRelativePosix(cwd: string, absolute: string): string {
  return relative(cwd, absolute).split(sep).join(posix.sep);
}

/**
 * Where a fixture snippet's text begins in the file that declares it, and how
 * far it is indented there.
 *
 * A snippet reaches ast-grep dedented — `yaml` strips the block scalar's
 * indentation — so a finding's position is relative to the snippet, not to the
 * document the author has open. These two numbers are what turn one into the
 * other.
 */
interface SnippetAnchor {
  /** Zero-based line in the test file where the snippet's first line sits. */
  line: number;
  /** Columns of block-scalar indentation stripped from every snippet line. */
  indent: number;
  /** Whether a per-line mapping is sound at all; see {@link anchorOf}. */
  perLine: boolean;
}

/**
 * Locate a fixture snippet inside the YAML that declares it.
 *
 * Only a LITERAL block scalar (`|`) gets a per-line mapping. It is the spelling
 * ast-grep's own test files use and the only one where snippet line N is file
 * line `start + N`: a FOLDED scalar (`>`) joins lines, and a plain or quoted
 * scalar can carry escapes, so in both the snippet's line numbering is not the
 * file's. Rather than report a confidently wrong line, those anchor to the
 * snippet's first line with no column offset — still somewhere the author can
 * open, and honest about the precision available.
 */
function anchorOf(source: string, item: Scalar): SnippetAnchor {
  const start = item.range?.[0] ?? 0;
  const lineOf = (offset: number): number =>
    source.slice(0, offset).split("\n").length - 1;

  if (item.type !== "BLOCK_LITERAL") {
    return { line: lineOf(start), indent: 0, perLine: false };
  }

  // A block scalar's content starts on the line after its `|` header, and every
  // content line carries the same indentation, which `yaml` has already
  // stripped from the value handed to ast-grep.
  const newline = source.indexOf("\n", start);
  if (newline === -1) return { line: lineOf(start), indent: 0, perLine: false };
  const contentStart = newline + 1;
  // YAML detects a block scalar's indentation from its first NON-EMPTY line:
  // leading blank lines carry no indentation and must not be measured. Reading
  // the literal first line instead reports indent 0 for a snippet written with
  // a leading blank line, which shifts every column left by the real indent —
  // wrong rather than merely imprecise, since `perLine` stays true here.
  // `line` still refers to the first content line, blank or not, because the
  // value handed to ast-grep keeps those blanks and its line numbers count them.
  let indent = 0;
  for (
    let lineStart = contentStart;
    lineStart < source.length;
    lineStart = source.indexOf("\n", lineStart) + 1
  ) {
    const lineEnd = source.indexOf("\n", lineStart);
    const text = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (text.trim() !== "") {
      indent = text.length - text.trimStart().length;
      break;
    }
    if (lineEnd === -1) break;
  }
  return { line: lineOf(contentStart), indent, perLine: true };
}

/** Move a finding's position from snippet coordinates into file coordinates. */
function reanchor(
  range: AstGrepMatch["range"],
  anchor: SnippetAnchor
): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  if (!anchor.perLine) {
    return {
      start: { line: anchor.line, column: 0 },
      end: { line: anchor.line, column: 0 },
    };
  }
  return {
    start: {
      line: anchor.line + range.start.line,
      column: range.start.column + anchor.indent,
    },
    end: {
      line: anchor.line + range.end.line,
      column: range.end.column + anchor.indent,
    },
  };
}

/**
 * Scan one snippet with one rule, over stdin.
 *
 * Resolves to the matches ast-grep reported, or to an empty list when it could
 * not run the rule at all. A rule it cannot parse is not an exception here: the
 * caller's job is to report findings, and a rule that produces none — because
 * its `language:` is one ast-grep does not know — is reported as a rule with no
 * findings, exactly as the schema's "present and empty" contract requires.
 */
async function scanSnippet(
  cwd: string,
  ruleFile: string,
  snippet: string
): Promise<AstGrepMatch[]> {
  const sgBinary = findSgBinary();
  return new Promise((resolve) => {
    const child = spawn(
      sgBinary,
      ["scan", "-r", ruleFile, "--stdin", "--json=stream"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PATH: buildPath() },
      }
    );

    const matches: AstGrepMatch[] = [];
    // `node:readline` over stdout, which handles character boundaries itself —
    // the same treatment `runAstGrepScan` gives the identical stream.
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      try {
        matches.push(JSON.parse(trimmed) as AstGrepMatch);
      } catch {
        // Non-JSON status lines are not findings.
      }
    });

    // Drained rather than ignored: ast-grep writes its rule-parse diagnostics
    // here, and a full pipe would block the child instead of letting it exit.
    child.stderr.resume();

    child.on("error", () => {
      resolve([]);
    });
    child.on("close", (code) => {
      resolve(code === SG_RULE_PARSE_FAILURE ? [] : matches);
    });

    child.stdin.on("error", () => {
      // A rule ast-grep refuses closes stdin before the snippet is written.
      // That is the parse failure above, reported by exit code, not a crash.
    });
    child.stdin.end(snippet);
  });
}

/** The bucket keys of an ast-grep test document, in the vocabulary it uses. */
const BUCKETS: { key: "valid" | "invalid"; bucket: FixtureBucket }[] = [
  { key: "valid", bucket: "pass" },
  { key: "invalid", bucket: "fail" },
];

/**
 * Every finding this rule's fixtures produced, tagged with its bucket.
 *
 * `file` is the TEST FILE that declares the snippet, cwd-relative and POSIX —
 * the shape the other engines report, and the one place the author can
 * actually go and edit. The temp path a materialising implementation would
 * have reported, and ast-grep's own `STDIN`, are both useless to them.
 *
 * Returns an empty list rather than throwing for every way this can come up
 * short — no rule file, no test directory, a rule ast-grep cannot parse. The
 * findings are evidence ABOUT a verdict that has already been decided
 * elsewhere by `sg test`; failing to gather them must not change it.
 */
export async function collectSgFixtureFindings(
  cwd: string,
  ruleId: string
): Promise<FixtureFinding[]> {
  const ruleFile = ruleFilePath(cwd, "sg", ruleId);
  const testsDirectory = ruleTestsDirectory(cwd, "sg", ruleId);
  const entries = await bucketEntries(testsDirectory);
  const testFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    )
    .map((entry) => join(testsDirectory, entry.name))
    .toSorted();

  const findings: FixtureFinding[] = [];

  for (const testFile of testFiles) {
    let source: string;
    try {
      source = await readFile(testFile, "utf8");
    } catch {
      continue;
    }

    let document;
    try {
      document = parseDocument(source);
    } catch {
      // A malformed test file is `verify`'s finding to report, not this one's.
      continue;
    }

    // The same exclusion `countFixtures` applies: a file carrying another
    // rule's `id:` is not this rule's fixture set, and ast-grep would not run
    // it under this rule either.
    // Compared as a string: an unquoted numeric `id:` (`id: 123`) resolves to
    // the JS number 123, which never equals the string ruleId, so the file
    // would be excluded from its own rule's fixtures and the findings would
    // silently read as empty.
    if (String(document.get("id")) !== ruleId) continue;

    const reportedFile = toRelativePosix(cwd, testFile);

    for (const { key, bucket } of BUCKETS) {
      const sequence = document.get(key) as YAMLSeq | undefined;
      if (sequence === undefined || !Array.isArray(sequence.items)) continue;

      for (const item of sequence.items as Scalar[]) {
        if (typeof item?.value !== "string") continue;
        const snippet = item.value;
        const anchor = anchorOf(source, item);
        const matches = await scanSnippet(cwd, ruleFile, snippet);

        for (const match of matches) {
          const result = toCheckResult(match);
          findings.push({
            ...result,
            // ast-grep writes `"note": null` for a rule without one, and
            // `toCheckResult` passes it through — harmless for `check`, which
            // does not validate, but the `test` payload is parsed by a schema
            // where `note` is an optional STRING. Normalised to absent here
            // rather than in `toCheckResult`, which would change the shape
            // `check --json` has been emitting.
            note: result.note ?? undefined,
            // ast-grep reports `STDIN`; the author needs the file that declares
            // the snippet. Overridden unconditionally rather than only when it
            // reads `STDIN`, so a future ast-grep that named the stream
            // differently could not leak an unopenable path.
            file: reportedFile,
            range: reanchor(match.range, anchor),
            bucket,
          });
        }
      }
    }
  }

  return findings;
}
