import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  buildCommandStub,
  buildSkillStub,
  isShimStub,
  stubFrontmatterDrifted,
  stubPredatesRecovery,
  writeCanonicalCommand,
  writeCanonicalSkill,
  type CommandStubFrontmatter,
  type StubFrontmatter,
} from "./canonical";
import { parseFrontmatter } from "./frontmatter";
import {
  computeInstallDiff,
  readInstallState,
  writeInstallState,
  type InstallMode,
  type InstallState,
} from "./state";

// Skill files embedded at build time via Vite import.meta.glob
const skillFiles: Record<string, string> = import.meta.glob(
  "../../../../skills/**/SKILL.md",
  { query: "?raw", import: "default", eager: true }
);

// Command files embedded at build time via Vite import.meta.glob
const commandFiles: Record<string, string> = import.meta.glob(
  "../../../../commands/tskl/**/*.md",
  { query: "?raw", import: "default", eager: true }
);

/**
 * Taskless-owned namespace holding the canonical skill/command content. It is
 * never a tool target — no detection, install, or cleanup logic points here.
 */
export const CANONICAL_DIR = ".taskless";

// --- Types ---

export interface DetectionSignal {
  type: "directory" | "file";
  path: string;
}

/**
 * A detectable AI tool. Used only for detection — the install destination is
 * `installDir`, which is matched against the fixed {@link SHIM_TARGETS}
 * catalog to decide which directories to pre-check in the wizard.
 */
export interface ToolDescriptor {
  name: string;
  detect: DetectionSignal[];
  installDir: string;
}

export interface EmbeddedSkill {
  name: string;
  description: string;
  content: string;
  body: string;
  metadata: Record<string, string>;
}

export interface EmbeddedCommand {
  filename: string;
  content: string;
  name: string;
  description: string;
  argumentHint?: string;
}

export interface SkillStatus {
  name: string;
  installedVersion: string | undefined;
  currentVersion: string;
  current: boolean;
}

export interface ToolStatus {
  name: string;
  skills: SkillStatus[];
}

// --- Tool Registry (detection only) ---

export const TOOLS: ToolDescriptor[] = [
  {
    name: "Claude Code",
    detect: [
      { type: "directory", path: ".claude" },
      { type: "file", path: "CLAUDE.md" },
    ],
    installDir: ".claude",
  },
  {
    name: "OpenCode",
    detect: [
      { type: "directory", path: ".opencode" },
      { type: "file", path: "opencode.jsonc" },
      { type: "file", path: "opencode.json" },
    ],
    installDir: ".opencode",
  },
  {
    name: "Cursor",
    detect: [
      { type: "directory", path: ".cursor" },
      { type: "file", path: ".cursorrules" },
    ],
    installDir: ".cursor",
  },
  {
    name: "Codex",
    detect: [
      { type: "directory", path: ".codex" },
      { type: "file", path: ".codex/config.toml" },
    ],
    installDir: ".agents",
  },
];

/**
 * A selectable stub destination. The wizard offers this fixed catalog as the
 * "which tools do you want to enable Taskless for?" multiselect; every entry
 * is a peer, no directory is special-cased or routed onto another.
 *
 * The catalog is a list of *rows the user reads*, not a list of directories:
 * more than one row may name the same `dir`. Anything downstream of the
 * picker works in directories and must therefore collapse the rows first,
 * which is what {@link uniqueShimTargets} is for.
 */
export interface ShimTarget {
  /** Directory the stub is written into, relative to the project root. */
  dir: string;
  /** Human-readable label for prompts and summaries. */
  label: string;
  /** Whether this directory receives the `tskl` command stub. */
  commands: boolean;
  /**
   * Marks the catch-all row: the one offered to anyone whose harness this
   * catalog does not name. At most one row carries it.
   *
   * It is a declared field rather than something derived, because every way
   * of inferring it is a coincidence. "The last row for the directory" is
   * declaration order, and "the object `uniqueShimTargets` happened to keep"
   * is reference identity, so reordering the catalog or making the dedupe
   * return copies would silently move the hint to a named harness with no
   * type error anywhere.
   */
  generic?: boolean;
}

/**
 * Codex and Agent Skills deliberately share `.agents/`. Both rows stay.
 * People scan this list for the name of the tool they use, and a Codex user
 * who sees only "Agent Skills" concludes Taskless does not support their
 * harness, which is how we lost one. "Agent Skills" still serves anyone on a
 * harness this catalog does not enumerate. Do not merge the two rows into one
 * label: the duplicate directory is the point, not an oversight.
 */
export const SHIM_TARGETS: readonly ShimTarget[] = [
  { dir: ".claude", label: "Claude Code", commands: true },
  { dir: ".agents", label: "Codex", commands: false },
  { dir: ".cursor", label: "Cursor", commands: true },
  { dir: ".opencode", label: "OpenCode", commands: false },
  { dir: ".agents", label: "Agent Skills", commands: false, generic: true },
];

/**
 * The catalog collapsed to one entry per directory, in catalog order.
 *
 * Every consumer that turns rows into directories or into install targets
 * goes through here. Without it, a single `.agents/` selection matches both
 * `.agents/` rows and the plan writes, reports, and records that directory
 * twice. Deduping on `dir` (rather than special-casing Codex) keeps that
 * one-entry-per-directory invariant true for any future pair of rows sharing
 * a destination.
 *
 * What it does NOT do is reconcile the rows: the surviving entry is one whole
 * row, so EVERY field comes from the last row for that directory, not just
 * `label`. Today both `.agents/` rows agree on `commands`, so nothing is
 * silently chosen. A future pair that disagreed on it would be resolved by
 * catalog order rather than by anyone deciding, which is a reason to keep
 * rows sharing a directory identical apart from `label` and `generic`.
 *
 * The LAST row for a directory wins both its position and its value. The
 * catalog is ordered named-harness first, generic-fallback last, so `.agents/`
 * is summarised as "Agent Skills" and sorts last: the selection carries only a
 * directory, never which row was ticked, and the generic label is the one that
 * is accurate either way.
 *
 * The `delete` before the `set` is what buys the position half. `Map.set`
 * alone overwrites the value but keeps the FIRST insertion's position, which
 * would leave `.agents/` holding the `Codex` row's slot (second) while
 * displaying the `Agent Skills` label. That reorders writes and summary lines
 * in every multi-tool install, for a change that is only supposed to add a
 * label, and it quietly contradicts the generic-fallback-last ordering this
 * comment relies on.
 */
export function uniqueShimTargets(): ShimTarget[] {
  const byDirectory = new Map<string, ShimTarget>();
  for (const shim of SHIM_TARGETS) {
    byDirectory.delete(shim.dir);
    byDirectory.set(shim.dir, shim);
  }
  return [...byDirectory.values()];
}

/** Directory selected by default when no tools are detected. */
export const DEFAULT_SHIM_DIR = ".agents";

// --- Detection ---

async function checkSignal(
  cwd: string,
  signal: DetectionSignal
): Promise<boolean> {
  const fullPath = join(cwd, signal.path);
  if (signal.type === "directory") {
    return stat(fullPath)
      .then((s) => s.isDirectory())
      .catch(() => false);
  }
  return stat(fullPath)
    .then((s) => s.isFile())
    .catch(() => false);
}

export async function detectTools(cwd: string): Promise<ToolDescriptor[]> {
  const results = await Promise.all(
    TOOLS.map(async (tool) => {
      const signals = await Promise.all(
        tool.detect.map((signal) => checkSignal(cwd, signal))
      );
      return signals.some(Boolean) ? tool : undefined;
    })
  );
  return results.filter((t): t is ToolDescriptor => t !== undefined);
}

/**
 * The shim directories to pre-select for a project: the install directories
 * of every detected tool, or `.agents/` when nothing is detected.
 */
export async function detectSelectedDirectories(
  cwd: string
): Promise<string[]> {
  const tools = await detectTools(cwd);
  if (tools.length === 0) return [DEFAULT_SHIM_DIR];
  const directories = new Set(tools.map((t) => t.installDir));
  return uniqueShimTargets()
    .map((s) => s.dir)
    .filter((d) => directories.has(d));
}

// --- Embedded Skills ---

export function getEmbeddedSkills(): EmbeddedSkill[] {
  return Object.entries(skillFiles).map(([path, content]) => {
    const parsed = parseFrontmatter(content);
    const data = parsed.data as {
      name?: string;
      description?: string;
      metadata?: Record<string, string>;
    };
    return {
      name: data.name ?? basename(dirname(path)),
      description: data.description ?? "",
      content,
      body: parsed.content,
      metadata: (data.metadata as Record<string, string>) ?? {},
    };
  });
}

// --- Embedded Commands ---

export function getEmbeddedCommands(): EmbeddedCommand[] {
  return Object.entries(commandFiles).map(([path, content]) => {
    const parsed = parseFrontmatter(content);
    const data = parsed.data as {
      name?: string;
      description?: string;
      "argument-hint"?: string;
    };
    const filename = basename(path);
    return {
      filename,
      content,
      name: data.name ?? filename.replace(/\.md$/, ""),
      description: data.description ?? "",
      argumentHint: data["argument-hint"],
    };
  });
}

// --- Install Plan ---

/**
 * A resolved install target. Either the single `canonical` `.taskless/` store
 * (full content) or a `reference` tool directory (thin stubs).
 */
export interface PlanTarget {
  dir: string;
  label: string;
  mode: InstallMode;
  skills: EmbeddedSkill[];
  commands: EmbeddedCommand[];
}

export interface InstallPlan {
  targets: PlanTarget[];
}

/**
 * Build an install plan: the always-present canonical `.taskless/` target
 * plus one `reference` stub target per selected directory. The canonical
 * target is included whenever the plan carries any skill or command.
 */
export function buildInstallPlan(
  selectedDirectories: readonly string[],
  skills: EmbeddedSkill[],
  commands: EmbeddedCommand[]
): InstallPlan {
  const targets: PlanTarget[] = [];

  if (skills.length > 0 || commands.length > 0) {
    targets.push({
      dir: CANONICAL_DIR,
      label: "Taskless canonical store",
      mode: "canonical",
      skills,
      commands,
    });
  }

  // Iterate the deduplicated catalog: two rows share `.agents/`, and matching
  // both would plan that directory twice, so it would be written twice and
  // reported twice in the install summary.
  for (const shim of uniqueShimTargets()) {
    if (!selectedDirectories.includes(shim.dir)) continue;
    targets.push({
      dir: shim.dir,
      label: shim.label,
      mode: "reference",
      skills,
      commands: shim.commands ? commands : [],
    });
  }

  return { targets };
}

/**
 * The install-state target map a plan would produce. Shared by
 * {@link applyInstallPlan} and callers that need to preview the diff (the
 * wizard) so both derive identical state.
 */
export function planToStateTargets(plan: InstallPlan): InstallState["targets"] {
  const targets: InstallState["targets"] = {};
  for (const target of plan.targets) {
    targets[target.dir] = {
      skills: target.skills.map((s) => s.name),
      commands: target.commands.map((c) => c.filename),
      mode: target.mode,
    };
  }
  return targets;
}

// --- Installation ---

export interface ApplyInstallOptions {
  cliVersion: string;
}

export interface ApplyInstallResult {
  state: InstallState;
  writtenSkills: Array<{ target: string; skill: string }>;
  writtenCommands: Array<{ target: string; command: string }>;
  removedSkills: Array<{ target: string; skill: string }>;
  removedCommands: Array<{ target: string; command: string }>;
}

/** Filesystem path of a skill directory inside any target. */
function skillDirectory(
  cwd: string,
  targetDirectory: string,
  name: string
): string {
  return join(cwd, targetDirectory, "skills", name);
}

/** Filesystem path of a command file inside any target. */
function commandFile(
  cwd: string,
  targetDirectory: string,
  filename: string
): string {
  return join(cwd, targetDirectory, "commands", "tskl", filename);
}

/** Replace `path` with a regular file if it currently exists as a symlink. */
async function unlinkIfSymlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      await rm(path, { force: true });
    }
  } catch {
    // Missing path — nothing to unlink.
  }
}

/**
 * Whether a `reference` file at `path` must be (re)written. Self-healing: a
 * file is rewritten unless it is already a current, non-drifted shim stub.
 * That converges anything stale onto the canonical-plus-stub layout —
 * a missing file, a full copy left by an older install, a symlink, or a
 * stub whose frontmatter has drifted.
 *
 * A stub written before stubs carried a recovery instruction is rewritten too.
 * That is the one case here where the BODY decides, and it has to: the reason
 * a stub without the instruction is a problem is that its canonical target may
 * be absent, and an already-installed project is exactly where that happens.
 * Waiting for a `name`/`description` change to carry the fix would leave those
 * projects on a dead-end stub indefinitely.
 */
async function referenceNeedsRewrite(
  path: string,
  meta: StubFrontmatter
): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    return true; // missing
  }
  if (stats.isSymbolicLink()) return true; // always replace a symlink
  const existing = await readFile(path, "utf8").catch(() => {});
  if (existing === undefined) return true;
  if (!isShimStub(existing)) return true; // a full copy — convert it
  if (stubPredatesRecovery(existing)) return true; // one-time body migration
  return stubFrontmatterDrifted(existing, meta);
}

/**
 * Write a skill into a target. A `canonical` target receives the full
 * embedded content; a `reference` target receives a shim stub, (re)written
 * per {@link referenceNeedsRewrite}. Returns whether a file was written.
 */
async function writeSkill(
  cwd: string,
  target: PlanTarget,
  skill: EmbeddedSkill
): Promise<boolean> {
  if (target.mode === "canonical") {
    await writeCanonicalSkill(cwd, skill.name, skill.content);
    return true;
  }

  const path = join(skillDirectory(cwd, target.dir, skill.name), "SKILL.md");
  // A prior link-skills-style setup may have left the per-skill directory as a
  // symlink to source; writing a stub through it would clobber the source file.
  // Replace a symlinked target directory with a real one before writing.
  await unlinkIfSymlink(dirname(path));
  const meta: StubFrontmatter = {
    name: skill.name,
    description: skill.description,
  };
  if (!(await referenceNeedsRewrite(path, meta))) return false;

  await unlinkIfSymlink(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildSkillStub(meta), "utf8");
  return true;
}

/**
 * Write a command into a target. Mirrors {@link writeSkill}: full content for
 * a `canonical` target, a self-healing shim stub for a `reference` target.
 */
async function writeCommand(
  cwd: string,
  target: PlanTarget,
  command: EmbeddedCommand
): Promise<boolean> {
  if (target.mode === "canonical") {
    await writeCanonicalCommand(cwd, command.filename, command.content);
    return true;
  }

  const path = commandFile(cwd, target.dir, command.filename);
  // As in writeSkill: a symlinked command namespace directory would otherwise
  // route the stub write back into source. Normalize it to a real directory.
  await unlinkIfSymlink(dirname(path));
  const meta: CommandStubFrontmatter = {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
  };
  if (!(await referenceNeedsRewrite(path, meta))) return false;

  await unlinkIfSymlink(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildCommandStub(meta, command.filename), "utf8");
  return true;
}

/**
 * Apply an install plan. The previous manifest state drives surgical cleanup:
 * only skills/commands recorded for a target and no longer present are
 * removed, and each removal is scoped to that target's own directory — so no
 * target's cleanup can ever reach into the canonical `.taskless/` store.
 */
export async function applyInstallPlan(
  cwd: string,
  plan: InstallPlan,
  options: ApplyInstallOptions
): Promise<ApplyInstallResult> {
  const previousState = await readInstallState(cwd);

  const nextState: InstallState = {
    cliVersion: options.cliVersion,
    targets: planToStateTargets(plan),
  };

  const diff = computeInstallDiff(previousState, nextState);

  const removedSkills: Array<{ target: string; skill: string }> = [];
  const removedCommands: Array<{ target: string; command: string }> = [];

  // Removals are scoped to each diff entry's own directory. Since no tool
  // target's directory is ever `.taskless`, this can never delete canonical
  // content as a side effect of cleaning up another target.
  for (const entry of diff.entries) {
    for (const skillName of entry.removals.skills) {
      await rm(skillDirectory(cwd, entry.target, skillName), {
        recursive: true,
        force: true,
      });
      removedSkills.push({ target: entry.target, skill: skillName });
    }
    for (const filename of entry.removals.commands) {
      await rm(commandFile(cwd, entry.target, filename), { force: true });
      removedCommands.push({ target: entry.target, command: filename });
    }
  }

  const writtenSkills: Array<{ target: string; skill: string }> = [];
  const writtenCommands: Array<{ target: string; command: string }> = [];

  for (const target of plan.targets) {
    for (const skill of target.skills) {
      if (await writeSkill(cwd, target, skill)) {
        writtenSkills.push({ target: target.dir, skill: skill.name });
      }
    }
    for (const command of target.commands) {
      if (await writeCommand(cwd, target, command)) {
        writtenCommands.push({ target: target.dir, command: command.filename });
      }
    }
  }

  await writeInstallState(cwd, nextState);

  return {
    state: nextState,
    writtenSkills,
    writtenCommands,
    removedSkills,
    removedCommands,
  };
}

// --- Staleness Check ---

async function readCanonicalSkillVersion(
  cwd: string,
  name: string
): Promise<string | undefined> {
  try {
    const content = await readFile(
      join(skillDirectory(cwd, CANONICAL_DIR, name), "SKILL.md"),
      "utf8"
    );
    const parsed = parseFrontmatter(content);
    const metadata = parsed.data.metadata as Record<string, string> | undefined;
    return metadata?.version;
  } catch {
    return undefined;
  }
}

/**
 * Report skill staleness for every detected tool. Versions are read from the
 * canonical `.taskless/` store — stubs are version-free — so every detected
 * tool reflects the single canonical install.
 */
export async function checkStaleness(cwd: string): Promise<ToolStatus[]> {
  const embedded = getEmbeddedSkills();
  const tools = await detectTools(cwd);

  const results: ToolStatus[] = [];

  for (const tool of tools) {
    const skillStatuses: SkillStatus[] = [];

    for (const skill of embedded) {
      const installedVersion = await readCanonicalSkillVersion(cwd, skill.name);
      const currentVersion = skill.metadata.version ?? "unknown";

      skillStatuses.push({
        name: skill.name,
        installedVersion,
        currentVersion,
        current: installedVersion === currentVersion,
      });
    }

    results.push({ name: tool.name, skills: skillStatuses });
  }

  return results;
}
