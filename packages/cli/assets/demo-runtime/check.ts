/**
 * Every `process.env` read must have a matching key in the repository-root
 * `.env`.
 *
 * This is the demonstration rule, and its subject was chosen for one property:
 * the evidence spans two files. The read is in a source file, the declaration
 * is in `.env`, and no single-file pattern can compare them. A rule whose
 * evidence fits in one file is an `sg` rule, so a single-file subject would
 * demonstrate this tier by exercising none of what makes it a tier.
 *
 * It imports nothing from `@taskless/*`. The harness contract is structural —
 * a default-exported async function taking `(root, matches)` and returning
 * findings — so a delivered check never depends on a package being installed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One normalized ast-grep match, as the harness hands it over. */
interface Match {
  /** The capture rule's stable name, which is what a check branches on. */
  rule: string;
  /** Path relative to `root`. */
  file: string;
  line: number;
  column: number;
  /** Captured metavariables by name. */
  captures: Record<string, string>;
}

/** One result the check returns. */
interface Finding {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity?: "error" | "warning" | "info";
}

/**
 * Keys declared in the repository-root `.env`, or none when it is absent.
 *
 * A missing `.env` yields an empty set rather than an error: a project with no
 * `.env` at all has declared nothing, which is exactly what the empty set
 * means, and every read in it is then correctly reported.
 */
function declaredKeys(root: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(join(root, ".env"), "utf8");
  } catch {
    return new Set();
  }

  const keys = new Set<string>();
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#") || text.startsWith("//")) continue;
    const equals = text.indexOf("=");
    // `<= 0` rather than `=== -1`: a line beginning with `=` has no name.
    if (equals <= 0) continue;
    keys.add(text.slice(0, equals).trim());
  }
  return keys;
}

export default async function check(
  root: string,
  matches: Match[]
): Promise<Finding[]> {
  const declared = declaredKeys(root);
  const findings: Finding[] = [];

  for (const match of matches) {
    // Branch on the capture rule's NAME, never on its id: the id is a
    // baked-in hash and is opaque to a check.
    if (match.rule !== "env-read") continue;

    const name = match.captures.VAR;
    if (name === undefined || declared.has(name)) continue;

    findings.push({
      file: match.file,
      line: match.line,
      column: match.column,
      message: `process.env.${name} is read here, but ${name} is not declared in .env`,
      severity: "error",
    });
  }

  return findings;
}
