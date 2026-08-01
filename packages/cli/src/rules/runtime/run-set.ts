import { cp, mkdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { addToGitignore } from "../../filesystem/gitignore";
import { signRuleFile } from "../rule-hash";
import type { ReportedFile, RunEntry } from "../../api/reconcile";
import { discoverRuntimeRulesIn, type RuntimeRule } from "./discover";

/** Directory (relative to `.taskless/`) holding materialized runtime rules. */
export const RUNTIME_RUN_DIR = ".run/runtime-rules";

/** A runtime rule paired with its `check.ts` signature — the reconcile gate. */
export interface SignedRuntimeRule {
  rule: RuntimeRule;
  /** Canonical signature envelope for the rule's `check.ts` bytes. */
  signature: string;
}

/** Result of signing a set of runtime rules' `check.ts` files. */
export interface RuntimeSigningResult {
  /** Rules whose `check.ts` was read and signed. */
  signed: SignedRuntimeRule[];
  /** Rules whose `check.ts` was missing or unreadable (cannot be reconciled). */
  unreadable: RuntimeRule[];
}

/**
 * Sign each runtime rule's `check.ts` (only) — the sole artifact carrying
 * arbitrary code execution. Capture `*.yml` are inert and are neither signed nor
 * reported. A rule whose `check.ts` cannot be read is returned in `unreadable`
 * (never thrown) so one malformed rule never aborts the whole `check`.
 */
export async function signRuntimeChecks(
  rules: RuntimeRule[]
): Promise<RuntimeSigningResult> {
  const signed: SignedRuntimeRule[] = [];
  const unreadable: RuntimeRule[] = [];
  await Promise.all(
    rules.map(async (rule) => {
      try {
        signed.push({ rule, signature: await signRuleFile(rule.checkFile) });
      } catch {
        unreadable.push(rule);
      }
    })
  );
  return { signed, unreadable };
}

/** Map signed runtime rules to the reconcile report (`check.ts` path + signature). */
export function reportRuntimeChecks(
  cwd: string,
  signed: SignedRuntimeRule[]
): ReportedFile[] {
  return signed.map(({ rule, signature }) => ({
    // Reconcile paths are repo-relative POSIX; normalize Windows separators.
    file: relative(cwd, rule.checkFile).split(sep).join("/"),
    signature,
  }));
}

/** The blessed/withheld split from a successful reconciliation. */
export interface RuntimeSelection {
  /** Rules whose `check.ts` signature is in the server `run` set. */
  blessed: RuntimeRule[];
  /** Rules whose `check.ts` was not blessed (advisory). */
  withheld: RuntimeRule[];
}

/**
 * Split signed runtime rules into those whose `check.ts` is present in the
 * server's `run` set (blessed, execute) and the rest (withheld, advisory). The
 * join is by signature — content-based, so a moved-but-unchanged rule resolves.
 */
export function selectBlessedRuntimeRules(
  signed: SignedRuntimeRule[],
  run: RunEntry[]
): RuntimeSelection {
  const runSignatures = new Set(run.map((entry) => entry.signature));
  const blessed: RuntimeRule[] = [];
  const withheld: RuntimeRule[] = [];
  for (const { rule, signature } of signed) {
    if (runSignatures.has(signature)) blessed.push(rule);
    else withheld.push(rule);
  }
  return { blessed, withheld };
}

/**
 * Materialize blessed runtime rules into the gitignored
 * `.taskless/.run/runtime-rules/` and return them re-discovered from there, so
 * the narrow and `check.ts` execute the blessed bytes rather than whatever is
 * live in `.taskless/runtime/rules/`.
 */
export async function materializeRuntimeRules(
  cwd: string,
  blessed: RuntimeRule[]
): Promise<RuntimeRule[]> {
  const runtimeRunRoot = join(cwd, ".taskless", RUNTIME_RUN_DIR);
  await rm(runtimeRunRoot, { recursive: true, force: true });
  await mkdir(runtimeRunRoot, { recursive: true });
  await Promise.all(
    blessed.map((rule) =>
      cp(rule.dir, join(runtimeRunRoot, rule.name), { recursive: true })
    )
  );
  await addToGitignore(cwd, [".run/"]);
  return discoverRuntimeRulesIn(runtimeRunRoot);
}
