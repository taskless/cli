import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  astGrepRuleFileCandidates,
  ENGINE_LAYOUTS,
  type EngineName,
} from "./engines";

/**
 * Which engines have a rule file for `ruleId`.
 *
 * Ownership is decided by **where the file is**, never by parsing it — the same
 * rule `dispatch` follows, so a rule cannot be verified by one engine and run
 * by another. `.taskless/vale/rules/<id>.yml` is Vale's; the ast-grep
 * candidates (including the pre-`0004` location) are `sg`'s.
 *
 * Returns every match rather than a single winner. Two engines holding the same
 * id is a real state — a project that authored `no-simply` under both — and
 * picking one silently would verify a file the user was not asking about. The
 * caller reports the ambiguity and names both paths.
 *
 * A missing directory or a path whose ancestor is a file both read as "not
 * here"; anything else is a real IO problem and propagates.
 */
export async function rulefileOwners(
  cwd: string,
  ruleId: string
): Promise<EngineName[]> {
  const candidates: Array<[EngineName, string[]]> = [
    ["sg", astGrepRuleFileCandidates(cwd, ruleId)],
    [
      "vale",
      [
        join(
          cwd,
          ".taskless",
          ENGINE_LAYOUTS.vale.rulesDirectory,
          `${ruleId}.yml`
        ),
      ],
    ],
  ];

  const owners: EngineName[] = [];
  for (const [engine, paths] of candidates) {
    for (const path of paths) {
      if (await isFile(path)) {
        owners.push(engine);
        break;
      }
    }
  }
  return owners;
}

/** Whether `path` is an existing regular file. */
async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/** Where a rule of each engine lives, for an error message that can be acted on. */
export function ruleFileLocation(engine: EngineName, ruleId: string): string {
  const layout = ENGINE_LAYOUTS[engine];
  return `.taskless/${layout.rulesDirectory}/${ruleId}.yml`;
}
