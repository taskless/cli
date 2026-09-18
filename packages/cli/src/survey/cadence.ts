import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getConfigDirectory } from "../auth/token";

const NEXT_ASK_FILE = "next_ask";

/**
 * Where a survey's cadence lives: one file per survey under the same XDG
 * config directory that holds the anonymous telemetry id.
 *
 * Keyed by survey rather than by CLI version. A directory per release would
 * grow without bound, and an upgrade should not reset the cadence: a newer
 * CLI reads the same file and may not ask right away, which is fine. A new
 * survey is a new id and therefore a new ask. Per-release segmentation still
 * works because `cliVersion` rides on every capture.
 */
export function nextAskPath(surveyId: string): string {
  return join(getConfigDirectory(), "surveys", surveyId, NEXT_ASK_FILE);
}

/**
 * The earliest time the next invite may be served, as epoch milliseconds, or
 * `undefined` when the file is absent or not a number. Both read as "ask
 * now"; the write that follows repairs a corrupt file.
 */
export async function readNextAsk(
  surveyId: string
): Promise<number | undefined> {
  let content: string;
  try {
    content = await readFile(nextAskPath(surveyId), "utf8");
  } catch {
    return undefined;
  }
  const value = Number(content.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** Record when the next invite may be served. Best-effort, like the anonymous id. */
export async function writeNextAsk(
  surveyId: string,
  at: number
): Promise<void> {
  const path = nextAskPath(surveyId);
  try {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, String(Math.trunc(at)), "utf8");
  } catch {
    // A cadence that could not be written means the invite may be served
    // again sooner than intended, which is the cheaper failure.
  }
}
