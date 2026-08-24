import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { stringify } from "yaml";

import { buildPath, findSgBinary, sgWalkArgv } from "../scan";
import type { Match } from "../../types/runtime-rule";
import type { LoadedCaptureRule, RuntimeRule } from "./discover";

/**
 * The subset of an ast-grep `--json=stream` match this harness reads. ast-grep
 * reports `range.start` 0-indexed; the harness normalizes to 1-indexed `Match`.
 */
interface AstGrepStreamMatch {
  text: string;
  file: string;
  ruleId: string;
  range: { start: { line: number; column: number } };
  metaVariables?: {
    single?: Record<string, { text?: string }>;
  };
}

/** Spawn `sg scan` with a temp config and stream stdout lines to `onLine`. */
function runSg(
  root: string,
  configPath: string,
  extraArguments: string[],
  paths: string[],
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const argv = [
      "scan",
      "--config",
      configPath,
      // The narrow is a `sg scan` over the user's project, so it walks it on
      // the same terms `runAstGrepScan` does — reaching `.github/`, and not
      // reaching `.taskless/`. A capture rule blind to the first would report
      // nothing for a workflow file; one that reached the second would anchor a
      // runtime rule on the CLI's own config.
      ...sgWalkArgv(paths),
      ...extraArguments,
      ...(paths.length > 0 ? ["--", ...paths] : []),
    ];
    const child = spawn(findSgBinary(), argv, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildPath() },
    });
    // One decoder for the stream — see the note in `runAstGrepScan`. stdout is
    // read through `node:readline`, which already decodes across boundaries.
    const stderrDecoder = new StringDecoder("utf8");
    const stderrChunks: string[] = [];
    const rl = createInterface({ input: child.stdout });
    rl.on("line", onLine);
    child.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(stderrDecoder.write(chunk))
    );
    child.on("error", reject);
    child.on("close", (code, signal) => {
      stderrChunks.push(stderrDecoder.end());
      // ast-grep exits 1 when matches are found — expected. A `null` code means
      // the process was killed by a signal (e.g. OOM); treat that and any exit
      // >1 as a real failure rather than silently dropping matches.
      if (code === null || code > 1) {
        const cause =
          code === null ? `signal ${String(signal)}` : `exit ${String(code)}`;
        // Test the joined text, not the chunk count: the decoder's final flush
        // pushes an empty string on a stream that ended cleanly, so counting
        // chunks would append a bare `: ` to every message.
        const stderr = stderrChunks.join("").trim();
        reject(
          new Error(
            `ast-grep narrow failed (${cause})${stderr === "" ? "" : `: ${stderr}`}`
          )
        );
        return;
      }
      resolve();
    });
  });
}

/** Copy the given capture files into `<directory>/rules/` and a config pointing at them. */
async function writeRuleConfig(
  directory: string,
  captureRules: LoadedCaptureRule[]
): Promise<string> {
  const rulesDirectory = join(directory, "rules");
  await mkdir(rulesDirectory, { recursive: true });
  // Copy the original `*.yml` bytes rather than re-serializing the parsed rule —
  // a YAML round-trip can subtly alter an exotic ast-grep config, and the file is
  // a valid ast-grep rule as delivered.
  await Promise.all(
    captureRules.map((c) => copyFile(c.file, join(rulesDirectory, c.fileName)))
  );
  const configPath = join(directory, "sgconfig.yml");
  await writeFile(configPath, stringify({ ruleDirs: ["rules"] }));
  return configPath;
}

/**
 * Run a runtime rule's capture rules as the ast-grep narrow and return the
 * normalized matches. Anchor captures produce full matches with `captures`;
 * broad (`kind: program`) captures are path-only enumerators. `ruleId` is mapped
 * back to the stable model `name` surfaced as `match.rule`.
 */
export async function runNarrow(
  root: string,
  rule: RuntimeRule,
  paths: string[] = []
): Promise<Match[]> {
  const nameById = new Map(rule.captureRules.map((c) => [c.id, c.name]));
  const anchor = rule.captureRules.filter((c) => c.match !== "broad");
  const broad = rule.captureRules.filter((c) => c.match === "broad");

  const workDirectory = await mkdtemp(join(tmpdir(), "tskl-narrow-"));
  const matches: Match[] = [];
  try {
    if (anchor.length > 0) {
      const config = await writeRuleConfig(
        join(workDirectory, "anchor"),
        anchor
      );
      await runSg(root, config, ["--json=stream"], paths, (line) => {
        const trimmed = line.trim();
        if (trimmed === "") return;
        let parsed: AstGrepStreamMatch;
        try {
          parsed = JSON.parse(trimmed) as AstGrepStreamMatch;
        } catch {
          return; // non-JSON status line
        }
        const captures: Record<string, string> = {};
        for (const [key, value] of Object.entries(
          parsed.metaVariables?.single ?? {}
        )) {
          if (typeof value.text === "string") captures[key] = value.text;
        }
        matches.push({
          rule: nameById.get(parsed.ruleId) ?? parsed.ruleId,
          ruleId: parsed.ruleId,
          file: parsed.file,
          line: parsed.range.start.line + 1,
          column: parsed.range.start.column + 1,
          text: parsed.text,
          captures,
        });
      });
    }

    // `--files-with-matches` reports paths only — it can't say which rule
    // matched — so run one broad scan per broad capture rule and attribute each
    // file to that rule. (Broad rules are whole-language enumerators, so this is
    // cheap and the common case is a single broad rule.)
    for (const broadRule of broad) {
      const config = await writeRuleConfig(
        join(workDirectory, `broad-${broadRule.id}`),
        [broadRule]
      );
      const seen = new Set<string>();
      await runSg(root, config, ["--files-with-matches"], paths, (line) => {
        const file = line.trim();
        if (file === "" || seen.has(file)) return;
        seen.add(file);
        matches.push({
          rule: broadRule.name,
          ruleId: broadRule.id,
          file,
          line: 1,
          column: 1,
          text: "",
          captures: {},
        });
      });
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
  return matches;
}
