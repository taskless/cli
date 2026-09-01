import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stringify } from "yaml";

import {
  applyCliInvocation,
  PROD_INVOCATION,
  withCliBuildNotice,
} from "../util/invocation";
import { parseFrontmatter } from "./frontmatter";

/**
 * The Taskless-owned namespace that holds canonical skill and command
 * content. No tool target ever installs into or cleans up this directory,
 * which is what makes the canonical content safe from destructive cleanup.
 */
const CANONICAL_DIR = ".taskless";

/**
 * Frontmatter fields copied verbatim from canonical content into a stub.
 * Intentionally version-free: a stub is part of the footprint outside
 * `.taskless`, so it must stay byte-stable across releases that do not change
 * its `name`/`description`. The canonical version lives only in `.taskless`.
 */
export interface StubFrontmatter {
  name: string;
  description: string;
}

/**
 * Command-stub frontmatter. Beyond `name`/`description`, the canonical
 * command's `argument-hint` is preserved so the slash command keeps its
 * editor argument hint.
 */
export interface CommandStubFrontmatter extends StubFrontmatter {
  argumentHint?: string;
}

/** Workspace-relative path of the canonical skill file for `name`. */
export function canonicalSkillPath(name: string): string {
  return `${CANONICAL_DIR}/skills/${name}/SKILL.md`;
}

/** Workspace-relative path of the canonical command file for `filename`. */
export function canonicalCommandPath(filename: string): string {
  return `${CANONICAL_DIR}/commands/tskl/${filename}`;
}

/**
 * Write a skill's full content to the canonical store at
 * `.taskless/skills/<name>/SKILL.md`. The canonical store is the single source
 * of truth; content is emitted as-is for prod builds. For `dev`/`self` builds
 * the CLI invocation is rewritten and a build notice prepended (see
 * {@link applyCliInvocation} / {@link withCliBuildNotice}); prod is unchanged.
 */
export async function writeCanonicalSkill(
  cwd: string,
  name: string,
  content: string
): Promise<string> {
  const directory = join(cwd, CANONICAL_DIR, "skills", name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  await writeFile(
    path,
    withCliBuildNotice(applyCliInvocation(content)),
    "utf8"
  );
  return path;
}

/**
 * Write a command's full content to the canonical store at
 * `.taskless/commands/tskl/<filename>`. Emitted as-is for prod builds; for
 * `dev`/`self` builds the CLI invocation is rewritten and a build notice
 * prepended (see {@link applyCliInvocation} / {@link withCliBuildNotice}).
 */
export async function writeCanonicalCommand(
  cwd: string,
  filename: string,
  content: string
): Promise<string> {
  const directory = join(cwd, CANONICAL_DIR, "commands", "tskl");
  await mkdir(directory, { recursive: true });
  const path = join(directory, filename);
  await writeFile(
    path,
    withCliBuildNotice(applyCliInvocation(content)),
    "utf8"
  );
  return path;
}

/**
 * Frontmatter `metadata` block stamped onto a stub. `type: shim` marks the
 * file as a reference stub so it is distinguishable from a full copy without
 * inspecting the body (see {@link isShimStub}). No version is recorded — the
 * stub footprint outside `.taskless` is kept stable across releases.
 */
function shimMetadata(): Record<string, string> {
  return { type: "shim" };
}

/**
 * The recovery invocation a released build writes, and the one form of it that
 * every build accepts from every other.
 *
 * It names no version and no machine-local path, so it resolves for anyone,
 * forever. That is what makes it the resting state of
 * {@link stubRecoveryInvocationStale}: a build whose own invocation differs
 * still leaves it alone, which is what keeps prod and a nightly from rewriting
 * each other's stub on every install.
 */
const PROD_RESTORE_COMMAND = `${PROD_INVOCATION} init`;

/**
 * The command a reader runs to restore a canonical file that is not on disk.
 *
 * Written in the published `npx @taskless/cli` form and rewritten by
 * {@link applyCliInvocation}, exactly as canonical content is. A stub that
 * hardcoded the released package would tell someone running a `self` build to
 * fetch a different binary than the one that wrote the stub, and would tell a
 * nightly user to install over their nightly.
 *
 * Because this is baked into the stub body, it is frozen at whichever build
 * wrote the file. {@link stubRecoveryInvocationStale} is what unfreezes it.
 *
 * `init` rather than a bare run: a bare invocation only installs from a TTY.
 * In a non-interactive context it prints a preamble and hands off to `agent`,
 * which is precisely the context an agent reading this stub is in. `init`
 * installs in both, falling back to a non-interactive install when there is
 * no TTY.
 *
 * Nothing here varies per release for a prod build, where
 * {@link applyCliInvocation} is a no-op, so the stub footprint outside
 * `.taskless` stays byte-stable (see {@link shimMetadata}).
 */
function restoreCommand(): string {
  return applyCliInvocation(PROD_RESTORE_COMMAND);
}

/**
 * The build-independent tail of the recovery sentence, shared between the
 * builders and {@link stubPredatesRecovery} so the two cannot drift apart.
 *
 * Detection of a *pre-recovery* stub keys on this fragment rather than on the
 * whole sentence: the invocation inside it differs between a prod build and a
 * `nightly`/`self` one, and treating the full text as the staleness test would
 * make each build treat the other's stub as stale and rewrite it on every
 * install. The invocation is compared separately and asymmetrically, by
 * {@link stubRecoveryInvocationStale}.
 */
const RECOVERY_TAIL = "to restore it, then read it.";

/** The literal that opens the recovery sentence's backtick-quoted command. */
const RECOVERY_RUN = "run `";

/** The literal between that command's closing backtick and the tail. */
const RECOVERY_AFTER_COMMAND = "` from the project root ";

/**
 * The sentence that turns a missing canonical file from a dead end into a
 * recoverable state. Without it a stub sends the reader to a path that may not
 * exist (an install whose untracked files never reached this worktree, or a
 * project that ignores `.taskless/skills/`) and says nothing about what to do
 * there. See taskless/cli#200.
 */
function recoveryInstruction(canonical: string): string {
  return (
    `If \`${canonical}\` does not exist, ${RECOVERY_RUN}${restoreCommand()}` +
    `${RECOVERY_AFTER_COMMAND}${RECOVERY_TAIL}\n`
  );
}

/**
 * Whether an existing stub was written before stubs carried a recovery
 * instruction. Used by install as a one-time migration, in the same spirit as
 * the `metadata.version` strip in {@link stubFrontmatterDrifted}: such a stub
 * is rewritten once, after which its body is stable again.
 */
export function stubPredatesRecovery(content: string): boolean {
  return !parseFrontmatter(content).content.includes(RECOVERY_TAIL);
}

/**
 * The invocation recorded inside an existing stub's recovery sentence, or
 * `undefined` when the stub has no recovery sentence at all (see
 * {@link stubPredatesRecovery}, which is what handles that case).
 *
 * The stub already carries the writing build's invocation in plain text, so
 * this reads it back rather than adding a frontmatter field to record it a
 * second time. Keeping it out of the frontmatter is what lets the fix land
 * with the prod stub's bytes completely unchanged — no field to add, and so no
 * migration rewrite for the installs that are already correct.
 */
export function stubRecoveryInvocation(content: string): string | undefined {
  const body = parseFrontmatter(content).content;
  const end = body.indexOf(`${RECOVERY_AFTER_COMMAND}${RECOVERY_TAIL}`);
  if (end === -1) return undefined;
  const start = body.lastIndexOf(RECOVERY_RUN, end);
  if (start === -1) return undefined;
  return body.slice(start + RECOVERY_RUN.length, end);
}

/**
 * Whether an existing stub's recovery invocation must be reclaimed by this
 * build. See taskless/cli#227.
 *
 * The recovery sentence is the one line a reader reaches for when the canonical
 * file is already gone, and until now the invocation inside it was frozen at
 * whichever build wrote the stub first. Install a nightly once and go back to
 * the released CLI and every later install reported "up to date" while the stub
 * kept pointing at `npx @taskless/cli-nightly@<pinned>` — a version that may no
 * longer be published, in the one situation where it has to work.
 *
 * The test is deliberately ASYMMETRIC, which is what keeps it from
 * reintroducing the cross-build rewrite loop `RECOVERY_TAIL` exists to prevent:
 *
 * - An invocation equal to this build's own is current. Nothing to do.
 * - {@link PROD_RESTORE_COMMAND} is accepted by EVERY build, released or not.
 *   It carries no version and no path, so it resolves for any reader; a nightly
 *   has no reason to overwrite it.
 * - Anything else names a build this one is not — another nightly's pin, a
 *   `self` path from someone else's checkout — and is rewritten.
 *
 * So the released form is a fixed point that every build converges on and none
 * moves away from: a prod install reclaims a nightly-written stub exactly once,
 * and a nightly install afterwards leaves the result alone. Two *different*
 * nightlies do rewrite each other, and should — the alternative is leaving a
 * pin from a build that is not present, which is the defect itself.
 */
export function stubRecoveryInvocationStale(content: string): boolean {
  const recorded = stubRecoveryInvocation(content);
  if (recorded === undefined) return false;
  if (recorded === restoreCommand()) return false;
  return recorded !== PROD_RESTORE_COMMAND;
}

/** Serialize ordered frontmatter fields into a `---`-delimited block. */
function frontmatterBlock(fields: Record<string, unknown>): string {
  const yaml = stringify(fields).trimEnd();
  return `---\n${yaml}\n---\n`;
}

/**
 * Build a reference skill stub: a real `SKILL.md` whose frontmatter carries
 * `name`/`description` (so the tool discovers and triggers it) and whose body
 * delegates to the canonical file without inlining its instructions.
 */
export function buildSkillStub(meta: StubFrontmatter): string {
  const canonical = canonicalSkillPath(meta.name);
  return (
    frontmatterBlock({
      name: meta.name,
      description: meta.description,
      metadata: shimMetadata(),
    }) +
    "\n" +
    `This is a Taskless reference stub. The canonical skill is defined at ` +
    `\`${canonical}\`.\n\n` +
    `Read \`${canonical}\` and follow its instructions.\n\n` +
    recoveryInstruction(canonical)
  );
}

/**
 * Build a reference command stub: a real command file whose frontmatter
 * carries `name`/`description` and whose body passes `$ARGUMENTS` through and
 * delegates to the canonical command file.
 */
export function buildCommandStub(
  meta: CommandStubFrontmatter,
  filename: string
): string {
  const canonical = canonicalCommandPath(filename);
  const fields: Record<string, unknown> = {
    name: meta.name,
    description: meta.description,
  };
  if (meta.argumentHint) fields["argument-hint"] = meta.argumentHint;
  fields.metadata = shimMetadata();
  return (
    frontmatterBlock(fields) +
    "\n" +
    `This command was invoked with: $ARGUMENTS\n\n` +
    `This is a Taskless reference stub. The canonical command is defined at ` +
    `\`${canonical}\`.\n\n` +
    `Read \`${canonical}\` and follow its instructions, treating the text ` +
    `above as the command arguments.\n\n` +
    recoveryInstruction(canonical)
  );
}

/**
 * Report whether an existing stub's frontmatter has drifted from what would
 * be generated now. Used by `update` to decide whether a stub needs
 * regeneration — a stub that still matches is left untouched.
 *
 * Drift triggers on a `name`/`description` change, and — as a one-time
 * migration — on the presence of a `metadata.version` field. Current stubs
 * carry no version; an older stub that still has one is rewritten once to
 * strip it, after which it stays byte-stable across releases.
 */
export function stubFrontmatterDrifted(
  existingStub: string,
  meta: StubFrontmatter
): boolean {
  const { data } = parseFrontmatter(existingStub);
  if (data.name !== meta.name || data.description !== meta.description) {
    return true;
  }
  const metadata = data.metadata as { version?: unknown } | undefined;
  return metadata?.version !== undefined;
}

/**
 * Whether `content` is a Taskless reference stub, identified by its
 * frontmatter `metadata.type === "shim"`. A full canonical copy lacks this
 * marker, so install can tell a stub apart from a copy it must convert.
 */
export function isShimStub(content: string): boolean {
  const { data } = parseFrontmatter(content);
  const metadata = data.metadata;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).type === "shim"
  );
}
