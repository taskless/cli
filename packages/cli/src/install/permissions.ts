import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import chalk from "chalk";
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";

// Sets `chalk.level` from the real terminal on import. This module renders
// colour, so it establishes that itself.
import "../util/color";

import {
  readManifest,
  writeManifest,
  type TasklessInstallManifest,
  type TasklessPermissionRecord,
} from "../filesystem/manifest";
import { isRecord } from "../util/is-record";

/**
 * Harness permission rules that allow exactly the installed Taskless CLI.
 *
 * Installing Taskless at a version is the user choosing to run that version,
 * so `init` records the choice in the project permission file of each harness
 * it installs the skill for. The CLI writes the rule, not the agent: a harness
 * that blocks the CLI also blocks an agent editing its own permissions.
 *
 * Three properties hold for every harness here:
 *
 * - The rule is never wider than the invocation. Each uses that harness's
 *   word-bounded form, so `@0.13.0` cannot match `@0.13.01`.
 * - A file holds exactly one Taskless rule set per package: the installed
 *   invocation's. Every other allow rule for the same package is removed,
 *   however it got there, since a pinned rule for a version that is no longer
 *   installed allows nothing anyone wants. The other package's rules are left
 *   to the other package, so a nightly and the release installed side by side
 *   do not undo each other. Deny rules, and rules for anything else, are
 *   never touched. The manifest record decides only whether a file Taskless
 *   created may be deleted once it is empty.
 * - A file that denies the invocation, or does not parse, is left alone.
 *
 * The list is closed. A harness joins by becoming an install target with a
 * documented, file-based allowlist that can scope to one command; every other
 * harness relies on the skill's per-command approval.
 */

/** One permission file's outcome, in the shape `init --json` carries. */
export interface PermissionEdit {
  /** Root-relative, `/`-separated path. */
  file: string;
  /** Whether this run created the file. */
  created: boolean;
  /** Rules added, as written in the file. */
  allowed: string[];
  /** Taskless rules for another invocation, removed. */
  removed: string[];
  /** Why the file was left alone, or `null` when it was not. */
  skipped: string | null;
}

type Records = Record<string, TasklessPermissionRecord>;

type EditResult =
  | { kind: "write"; text: string | undefined; added: string[] }
  | { kind: "skip"; reason: string };

interface Harness {
  /** The file this harness's rule goes in, relative to the project root. */
  locate(cwd: string): Promise<string>;
  /** Whether a recorded path belongs to this harness (for cleanup). */
  owns(file: string): boolean;
  /** The rules that allow exactly `invocation`. */
  rules(invocation: string): string[];
  /**
   * Every allow rule in `text` for a Taskless invocation, at any version,
   * written the way {@link Harness.edit} takes it in `remove`.
   */
  found(text: string | undefined): string[];
  /**
   * Remove `remove` and add `add` to `text` (absent when the file does not
   * exist). `undefined` text in the result deletes the file.
   */
  edit(
    text: string | undefined,
    add: readonly string[],
    remove: readonly string[],
    context: EditContext
  ): EditResult;
}

interface EditContext {
  invocation: string;
  /** This build's launcher, allowed beside the invocation, when it has one. */
  launcher?: string;
  /** Whether Taskless created this file, so may delete it once it is empty. */
  created: boolean;
}

// --- JSON editing -----------------------------------------------------------

const UNPARSEABLE = "does not parse, so it was left as it is";

/** Parse JSON or JSONC, or `undefined` when it does not parse. */
export function parseJson(text: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  return errors.length > 0 ? undefined : value;
}

/** The file's own indentation, so an edit does not reformat it. */
function formattingOf(text: string): FormattingOptions {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith("\t")) {
    return { insertSpaces: false, tabSize: 1, eol: "\n" };
  }
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol: "\n" };
}

/** The whitespace that opens the line holding `offset`. */
function indentAt(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}

/** A value on one line: `{ "action": "shell", … }` rather than a block. */
function inline(value: unknown): string {
  return JSON.stringify(value, undefined, 1).replaceAll(/\n\s*/g, " ");
}

/** Whether only whitespace, or a comment, follows `offset` on its line. */
function restOfLineIsBlank(text: string, offset: number): boolean {
  const lineEnd = text.indexOf("\n", offset);
  const rest = text.slice(offset, lineEnd === -1 ? text.length : lineEnd);
  return /^\s*(?:(?:\/\/|\/\*).*)?$/.test(rest);
}

/**
 * Place a bare insertion by hand, or `undefined` when it is not one this
 * handles. An entry appended after a sibling that ends its line gets a line of
 * its own, after any comment there; one inserted before a sibling on a line
 * of its own gets a line of its own above it. Anything inline stays inline.
 */
function placeBySibling(
  text: string,
  edit: { offset: number; length: number; content: string },
  value: unknown,
  isArrayInsertion: boolean
): string | undefined {
  if (edit.length > 0) return undefined;
  const indent = indentAt(text, edit.offset);
  if (edit.content.startsWith(",")) {
    const entry = edit.content
      .slice(1)
      .replace(/\{.*\}$/s, () => inline(value));
    if (!restOfLineIsBlank(text, edit.offset)) {
      return `${text.slice(0, edit.offset)}, ${entry}${text.slice(edit.offset)}`;
    }
    const lineEnd = text.indexOf("\n", edit.offset);
    const end = lineEnd === -1 ? text.length : lineEnd;
    return (
      `${text.slice(0, edit.offset)},${text.slice(edit.offset, end)}` +
      `\n${indent}${entry}${text.slice(end)}`
    );
  }
  if (isArrayInsertion && edit.content.endsWith(",")) {
    // The bare edit sits right after `[`; the sibling may start a line below.
    const element =
      edit.offset + Math.max(0, text.slice(edit.offset).search(/\S/));
    if (text.slice(edit.offset, element).includes("\n")) {
      return (
        `${text.slice(0, element)}${inline(value)},\n` +
        `${indentAt(text, element)}${text.slice(element)}`
      );
    }
    return `${text.slice(0, edit.offset)}${inline(value)}, ${text.slice(edit.offset)}`;
  }
  return undefined;
}

/** Whether `text` parses and holds `value` where it was written. */
function holds(
  text: string,
  path: (string | number)[],
  value: unknown,
  isArrayInsertion: boolean
): boolean {
  const root = parseJson(text);
  if (root === undefined) return false;
  const keys = path.map(String);
  const expected = JSON.stringify(value);
  if (isArrayInsertion) {
    const list = valueAt(root, keys.slice(0, -1));
    return (
      Array.isArray(list) &&
      list.some((item) => JSON.stringify(item) === expected)
    );
  }
  return JSON.stringify(valueAt(root, keys)) === expected;
}

/**
 * Delete the entry at `path`: an array element or an object property, with
 * the comma that separated it from its neighbour, and nothing else.
 *
 * Computed from the parse tree rather than asked of `jsonc-parser`, whose
 * removal range came up one character short after an inline insertion and
 * left a stray quote behind.
 */
function remove(text: string, path: (string | number)[]): string {
  const tree = parseTree(text, [], { allowTrailingComma: true });
  const found = tree === undefined ? undefined : findNodeAtLocation(tree, path);
  // A property is deleted whole, key included.
  const node = found?.parent?.type === "property" ? found.parent : found;
  const siblings = node?.parent?.children;
  if (node === undefined || siblings === undefined) return text;
  const index = siblings.indexOf(node);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  const [start, end] =
    previous === undefined
      ? [node.offset, next?.offset ?? node.offset + node.length]
      : [previous.offset + previous.length, node.offset + node.length];
  return text.slice(0, start) + text.slice(end);
}

/**
 * Write `value` at `path`, touching nothing else in the file.
 *
 * `jsonc-parser` is asked for a bare edit and the new entry is placed by hand
 * ({@link placeBySibling}), because its formatter reflows the line it inserts
 * beside, comment and all: appending after `"*": "ask" // ask by default` left
 * that comment describing the new entry. Removals are bare deletions. The
 * formatter is used to create a container that does not exist yet, where
 * there is no neighbour to disturb, and as the fallback whenever a hand-placed
 * edit would not parse back to the value it was meant to write.
 */
export function set(
  text: string,
  path: (string | number)[],
  value: unknown,
  options: { isArrayInsertion?: boolean } = {}
): string {
  if (value === undefined) return remove(text, path);
  const bare = modify(text, path, value, { ...options });
  const [edit] = bare;
  if (bare.length !== 1 || edit === undefined) {
    return applyEdits(text, bare);
  }
  const isArrayInsertion = options.isArrayInsertion === true;
  const placed = placeBySibling(text, edit, value, isArrayInsertion);
  if (placed !== undefined && holds(placed, path, value, isArrayInsertion)) {
    return placed;
  }
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: formattingOf(text),
      ...options,
    })
  );
}

export function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Whether a value holds nothing but empty objects and arrays. */
function isHollow(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((item) => isHollow(item));
  if (isRecord(value)) return Object.values(value).every((v) => isHollow(v));
  return false;
}

/**
 * Finish an edit: a file Taskless created that now holds nothing of anyone's
 * is deleted rather than left as an empty skeleton.
 */
function finish(
  text: string,
  added: string[],
  context: EditContext
): EditResult {
  if (context.created && isHollow(parseJson(text))) {
    return { kind: "write", text: undefined, added };
  }
  return { kind: "write", text, added };
}

/**
 * Edit a list of strings at `path`: remove recorded entries, append the rest.
 * An entry already present is not added again, and is not reported as added,
 * since it is the user's.
 */
function editStringList(
  text: string | undefined,
  path: string[],
  add: readonly string[],
  remove: readonly string[],
  context: EditContext,
  denies?: (root: unknown) => boolean
): EditResult {
  let current = text ?? "{}\n";
  let root = parseJson(current);
  if (!isRecord(root)) return { kind: "skip", reason: UNPARSEABLE };
  if (add.length > 0 && denies?.(root)) {
    return { kind: "skip", reason: "denies this command" };
  }
  const existing = valueAt(root, path);
  if (existing !== undefined && !Array.isArray(existing)) {
    return { kind: "skip", reason: `${path.join(".")} is not a list` };
  }

  for (const rule of remove) {
    const list = valueAt(root, path);
    const index = Array.isArray(list) ? list.indexOf(rule) : -1;
    if (index === -1) continue;
    current = set(current, [...path, index], undefined);
    root = parseJson(current);
  }

  const added: string[] = [];
  for (const rule of add) {
    const list = valueAt(root, path);
    if (Array.isArray(list) && list.includes(rule)) continue;
    current = Array.isArray(list)
      ? set(current, [...path, list.length], rule, { isArrayInsertion: true })
      : set(current, path, [rule]);
    root = parseJson(current);
    added.push(rule);
  }
  return finish(current, added, context);
}

// --- Matching a deny --------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * A glob as a regular expression: `*` is any run of characters, `?` one, and a
 * trailing ` *` also matches nothing at all, the reading every harness here
 * gives it. Deliberately generous, since it only decides when to hold back.
 */
function globToRegExp(glob: string): RegExp {
  const trailing = glob.endsWith(" *");
  const body = trailing ? glob.slice(0, -2) : glob;
  const source = escapeRegExp(body).replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${source}${trailing ? "( .*)?" : ""}$`, "s");
}

/** The commands this install allows: the invocation and its launcher. */
function allowedCommands(context: EditContext): string[] {
  return context.launcher === undefined
    ? [context.invocation]
    : [context.invocation, context.launcher];
}

/** Commands a deny covering Taskless would match. */
function sampleCommands(context: EditContext): string[] {
  return allowedCommands(context).flatMap((command) => [
    command,
    `${command} agent ok`,
  ]);
}

function coversAny(glob: string, context: EditContext): boolean {
  const pattern = globToRegExp(glob);
  return sampleCommands(context).some((command) => pattern.test(command));
}

/** Claude Code: `Bash`, `Bash(*)`, `Bash(npx *)`, `Bash(npx:*)`, … */
function claudeDenies(root: unknown, context: EditContext): boolean {
  const deny = valueAt(root, ["permissions", "deny"]);
  if (!Array.isArray(deny)) return false;
  return deny.some((rule) => {
    if (typeof rule !== "string") return false;
    if (rule === "Bash") return true;
    const match = /^Bash\((.*)\)$/s.exec(rule);
    if (match?.[1] === undefined) return false;
    const glob = match[1].endsWith(":*")
      ? `${match[1].slice(0, -2)} *`
      : match[1];
    return coversAny(glob, context);
  });
}

/** Cursor CLI: `Shell(base)` or `Shell(base:argsGlob)`. */
function cursorCliDenies(root: unknown, context: EditContext): boolean {
  const deny = valueAt(root, ["permissions", "deny"]);
  if (!Array.isArray(deny)) return false;
  return allowedCommands(context).some((command) => {
    const [base, ...rest] = command.split(" ");
    return deny.some((rule) => {
      if (typeof rule !== "string") return false;
      const match = /^Shell\(([^:)]*)(?::(.*))?\)$/s.exec(rule);
      if (match === null || match[1] !== base) return false;
      if (match[2] === undefined) return true;
      const args = globToRegExp(match[2]);
      return [rest.join(" "), `${rest.join(" ")} agent ok`].some((a) =>
        args.test(a)
      );
    });
  });
}

// --- Recognizing a Taskless rule --------------------------------------------

/**
 * A command that runs the Taskless CLI through a launcher, at any version or
 * none: `npx @taskless/cli@0.13.0`, `pnpm dlx @taskless/cli-nightly`. The
 * package name must end there, so `@taskless/cli-foo` is not Taskless.
 */
const TASKLESS_COMMAND =
  /^(?:npx|pnpm dlx) (@taskless\/cli(?:-nightly)?)(?:@[^\s]+)?$/;

/**
 * A package's project launcher, spelled from the project root. The rule for
 * it names no version, and it belongs to the package whose launcher it is.
 */
const LAUNCHER_COMMAND = /^\.\/\.taskless\/bin\/(cli|cli-nightly)\.mjs$/;

/**
 * The Taskless package `command` runs, less a trailing ` *` glob, or
 * `undefined` when it does not run the Taskless CLI.
 */
function tasklessPackage(command: string): string | undefined {
  const bare = command.replace(/ \*$/, "");
  const launcher = LAUNCHER_COMMAND.exec(bare)?.[1];
  if (launcher !== undefined) return `@taskless/${launcher}`;
  return TASKLESS_COMMAND.exec(bare)?.[1];
}

/** Whether `command`, less a trailing ` *` glob, runs the Taskless CLI. */
function isTasklessCommand(command: string): boolean {
  return tasklessPackage(command) !== undefined;
}

/** The strings in the list at `path` that `isTaskless` accepts. */
function foundInList(
  text: string | undefined,
  path: readonly string[],
  isTaskless: (entry: string) => boolean
): string[] {
  if (text === undefined) return [];
  const list = valueAt(parseJson(text), path);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is string => typeof entry === "string" && isTaskless(entry)
  );
}

/** Claude Code: `Bash(<cmd> *)`, `Bash(<cmd>:*)`, or `Bash(<cmd>)`. */
function isTasklessClaudeRule(rule: string): boolean {
  const inner = /^Bash\((.*)\)$/s.exec(rule)?.[1];
  return inner !== undefined && isTasklessCommand(inner.replace(/:\*$/, ""));
}

/**
 * Cursor CLI: `Shell(<base>:<args>)`, with or without a trailing ` *`, or a
 * bare `Shell(<base>)`, which is how a launcher with no arguments is allowed.
 */
function isTasklessCursorCliRule(rule: string): boolean {
  const match = /^Shell\(([^:)]+)(?::(.*))?\)$/s.exec(rule);
  if (match === null) return false;
  return isTasklessCommand(
    match[2] === undefined ? (match[1] ?? "") : `${match[1]} ${match[2]}`
  );
}

/**
 * The command a rule allows, in any harness's spelling, for a person to read:
 * `Bash(npx @taskless/cli@0.13.0 *)` and `Shell(npx:@taskless/cli@0.13.0)`
 * both read `npx @taskless/cli@0.13.0`.
 */
export function commandOfRule(rule: string): string {
  const bash = /^Bash\((.*)\)$/s.exec(rule)?.[1];
  const shell = /^Shell\(([^:)]+)(?::(.*))?\)$/s.exec(rule);
  const pattern =
    /^prefix_rule\(pattern = (\[.*\]), decision = "allow"\)$/.exec(rule)?.[1];
  let command = rule;
  if (bash !== undefined) {
    command = bash.replace(/:\*$/, "");
  } else if (shell !== null) {
    command =
      shell[2] === undefined
        ? (shell[1] ?? "")
        : `${shell[1] ?? ""} ${shell[2]}`;
  } else if (pattern !== undefined) {
    const words: unknown = parseJson(pattern);
    if (Array.isArray(words)) command = words.join(" ");
  }
  return command.replace(/ \*$/, "");
}

// --- The harnesses ----------------------------------------------------------

const CLAUDE_FILE = ".claude/settings.json";
const CURSOR_EDITOR_FILE = ".cursor/permissions.json";
const CURSOR_CLI_FILE = ".cursor/cli.json";
const CODEX_FILE = ".codex/rules/taskless.rules";
/**
 * How a Codex rules file Taskless wrote is recognised, even when the manifest
 * record is gone. Matched as a prefix so the rest of the header can be
 * reworded freely, but this mark itself must never change: every file written
 * before the change would stop being recognised, and be skipped from then on
 * as someone else's.
 */
const CODEX_MARK = "# Written by Taskless";
const CODEX_HEADER = `${CODEX_MARK}: allows exactly the installed Taskless CLI.\n`;
const OPENCODE_FILES = [
  "opencode.json",
  "opencode.jsonc",
  ".opencode/opencode.json",
  ".opencode/opencode.jsonc",
];
/** Where an OpenCode rule goes when the project has no config yet. */
const OPENCODE_DEFAULT = ".opencode/opencode.json";

function fixed(file: string): Pick<Harness, "locate" | "owns"> {
  return {
    locate: () => Promise.resolve(file),
    owns: (path) => path === file,
  };
}

const claudeCode: Harness = {
  ...fixed(CLAUDE_FILE),
  rules: (invocation) => [`Bash(${invocation} *)`],
  found: (text) =>
    foundInList(text, ["permissions", "allow"], isTasklessClaudeRule),
  edit: (text, add, remove, context) =>
    editStringList(text, ["permissions", "allow"], add, remove, context, (r) =>
      claudeDenies(r, context)
    ),
};

const cursorEditor: Harness = {
  ...fixed(CURSOR_EDITOR_FILE),
  rules: (invocation) => [invocation],
  found: (text) => foundInList(text, ["terminalAllowlist"], isTasklessCommand),
  edit: (text, add, remove, context) =>
    editStringList(text, ["terminalAllowlist"], add, remove, context),
};

const cursorCli: Harness = {
  ...fixed(CURSOR_CLI_FILE),
  rules: (invocation) => {
    const [base, ...rest] = invocation.split(" ");
    // A bare base allows the command with any arguments, which is the whole
    // rule for a launcher: it takes no fixed arguments of its own.
    if (rest.length === 0) return [`Shell(${base ?? ""})`];
    const args = rest.join(" ");
    return [`Shell(${base ?? ""}:${args})`, `Shell(${base ?? ""}:${args} *)`];
  },
  found: (text) =>
    foundInList(text, ["permissions", "allow"], isTasklessCursorCliRule),
  edit: (text, add, remove, context) =>
    editStringList(text, ["permissions", "allow"], add, remove, context, (r) =>
      cursorCliDenies(r, context)
    ),
};

/**
 * OpenCode, in whichever form the file already uses.
 *
 * The object form (`permission.bash`) applies the LAST matching rule, so the
 * Taskless key is appended after every existing key. The array form
 * (`permissions`, `{ action, resource, effect }`) is read top to bottom, so the
 * entry goes first. Either way, a deny that our rule would then override is
 * the user's decision, and the file is left alone.
 */
const openCode: Harness = {
  async locate(cwd) {
    for (const file of OPENCODE_FILES) {
      if ((await readText(join(cwd, file))) !== undefined) return file;
    }
    return OPENCODE_DEFAULT;
  },
  owns: (path) => OPENCODE_FILES.includes(path),
  rules: (invocation) => [`${invocation} *`],
  found(text) {
    if (text === undefined) return [];
    const root = parseJson(text);
    if (!isRecord(root)) return [];
    if (Array.isArray(root.permissions)) {
      return root.permissions.flatMap((entry) =>
        isRecord(entry) &&
        entry.action === "shell" &&
        entry.effect === "allow" &&
        typeof entry.resource === "string" &&
        isTasklessCommand(entry.resource)
          ? [entry.resource]
          : []
      );
    }
    const bash = valueAt(root, ["permission", "bash"]);
    if (!isRecord(bash)) return [];
    return Object.entries(bash)
      .filter(([glob, action]) => action === "allow" && isTasklessCommand(glob))
      .map(([glob]) => glob);
  },
  edit(text, add, remove, context) {
    let current = text ?? "{}\n";
    let root = parseJson(current);
    if (!isRecord(root)) return { kind: "skip", reason: UNPARSEABLE };

    if (Array.isArray(root.permissions)) {
      const isOurs = (entry: unknown, rule: string) =>
        isRecord(entry) &&
        entry.action === "shell" &&
        entry.effect === "allow" &&
        entry.resource === rule;
      if (
        add.length > 0 &&
        root.permissions.some(
          (entry) =>
            isRecord(entry) &&
            entry.effect === "deny" &&
            (entry.action === "shell" || entry.action === "*") &&
            typeof entry.resource === "string" &&
            coversAny(entry.resource, context)
        )
      ) {
        return { kind: "skip", reason: "denies this command" };
      }
      for (const rule of remove) {
        const list = valueAt(root, ["permissions"]);
        const index = Array.isArray(list)
          ? list.findIndex((entry) => isOurs(entry, rule))
          : -1;
        if (index === -1) continue;
        current = set(current, ["permissions", index], undefined);
        root = parseJson(current);
      }
      const added: string[] = [];
      for (const rule of add) {
        const list = valueAt(root, ["permissions"]);
        if (Array.isArray(list) && list.some((entry) => isOurs(entry, rule))) {
          continue;
        }
        current = set(
          current,
          ["permissions", 0],
          { action: "shell", resource: rule, effect: "allow" },
          { isArrayInsertion: true }
        );
        root = parseJson(current);
        added.push(rule);
      }
      return finish(current, added, context);
    }

    const permission = root.permission;
    if (permission !== undefined && !isRecord(permission)) {
      return {
        kind: "skip",
        reason: "sets `permission` to a single value for every tool",
      };
    }
    const bash = valueAt(root, ["permission", "bash"]);
    if (bash !== undefined && !isRecord(bash)) {
      return {
        kind: "skip",
        reason: "sets `permission.bash` to a single value for every command",
      };
    }
    if (
      add.length > 0 &&
      isRecord(bash) &&
      Object.entries(bash).some(
        ([glob, action]) => action === "deny" && coversAny(glob, context)
      )
    ) {
      return { kind: "skip", reason: "denies this command" };
    }
    for (const rule of remove) {
      const bashRules = valueAt(root, ["permission", "bash"]);
      if (!isRecord(bashRules) || bashRules[rule] !== "allow") continue;
      current = set(current, ["permission", "bash", rule], undefined);
      root = parseJson(current);
    }
    const added: string[] = [];
    for (const rule of add) {
      const bashRules = valueAt(root, ["permission", "bash"]);
      if (isRecord(bashRules) && rule in bashRules) continue;
      current = set(current, ["permission", "bash", rule], "allow");
      root = parseJson(current);
      added.push(rule);
    }
    return finish(current, added, context);
  },
};

/**
 * Codex, in a rules file Taskless owns outright, so the whole file is
 * rewritten rather than edited. A file at that path that Taskless neither
 * recorded nor marked with {@link CODEX_MARK} is someone else's and is left
 * alone. Codex applies the strictest matching rule (forbidden over prompt over
 * allow), so a deny elsewhere still wins without this file needing to look
 * for it.
 */
const codex: Harness = {
  ...fixed(CODEX_FILE),
  rules: (invocation) => [
    `prefix_rule(pattern = ${JSON.stringify(invocation.split(" "))}, decision = "allow")`,
  ],
  // Only a file Taskless wrote is read: one someone else put at this path is
  // theirs, whatever it allows.
  found(text) {
    if (text?.startsWith(CODEX_MARK) !== true) return [];
    return text.split("\n").filter((line) => {
      const pattern =
        /^prefix_rule\(pattern = (\[.*\]), decision = "allow"\)$/.exec(
          line
        )?.[1];
      if (pattern === undefined) return false;
      const words: unknown = parseJson(pattern);
      return (
        Array.isArray(words) &&
        words.every((word) => typeof word === "string") &&
        isTasklessCommand(words.join(" "))
      );
    });
  },
  edit(text, add, remove, context) {
    if (
      text !== undefined &&
      !context.created &&
      !text.startsWith(CODEX_MARK)
    ) {
      return {
        kind: "skip",
        reason: "already exists and was not written by Taskless",
      };
    }
    const kept = (text ?? "")
      .split("\n")
      .filter((line) => line.startsWith("prefix_rule("))
      .filter((line) => !remove.includes(line));
    const added = add.filter((rule) => !kept.includes(rule));
    const rules = [...kept, ...added];
    if (rules.length === 0) return { kind: "write", text: undefined, added };
    return {
      kind: "write",
      text:
        CODEX_HEADER +
        "# `taskless init` rewrites this file on every upgrade.\n" +
        rules.join("\n") +
        "\n",
      added,
    };
  },
};

const HARNESSES = [claudeCode, cursorEditor, cursorCli, openCode, codex];

/**
 * The harnesses that get a rule for this install: one per directory Taskless
 * installed the skill into, and Codex only when `.agents/` was selected AND
 * Codex is in the project, since `.agents/` is read by many harnesses and
 * names none of them.
 */
function harnessesFor(
  selected: readonly string[],
  codexDetected: boolean
): Harness[] {
  const harnesses: Harness[] = [];
  if (selected.includes(".claude")) harnesses.push(claudeCode);
  if (selected.includes(".cursor")) harnesses.push(cursorEditor, cursorCli);
  if (selected.includes(".opencode")) harnesses.push(openCode);
  if (selected.includes(".agents") && codexDetected) harnesses.push(codex);
  return harnesses;
}

// --- Sync -------------------------------------------------------------------

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readRecords(cwd: string): Promise<Records> {
  try {
    const { manifest } = await readManifest(join(cwd, ".taskless"));
    // Typed, but read as unknown: the manifest is a hand-editable file.
    const permissions: unknown = manifest.install?.permissions;
    if (!isRecord(permissions)) return {};
    const records: Records = {};
    for (const [file, record] of Object.entries(permissions)) {
      if (!isRecord(record) || !Array.isArray(record.rules)) continue;
      records[file] = {
        rules: record.rules.filter((r): r is string => typeof r === "string"),
        created: record.created === true,
      };
    }
    return records;
  } catch {
    return {};
  }
}

async function writeRecords(cwd: string, records: Records): Promise<void> {
  const directory = join(cwd, ".taskless");
  const { manifest, raw } = await readManifest(directory);
  const install: TasklessInstallManifest = { ...manifest.install };
  if (Object.keys(records).length === 0) {
    delete install.permissions;
  } else {
    install.permissions = records;
  }
  manifest.install = install;
  await writeManifest(directory, manifest, raw);
}

export interface SyncPermissionsOptions {
  /** Tool directories the skill is installed into. */
  selected: readonly string[];
  /** Whether Codex is present in the project. */
  codexDetected: boolean;
  /** The invocation to allow: this build's pinned CLI. */
  invocation: string;
  /**
   * This build's launcher, `./.taskless/bin/cli.mjs`, allowed beside the
   * invocation. Absent for a build that installs none.
   */
  launcher?: string;
  /** `false` reports what would change and writes nothing. */
  write: boolean;
}

/**
 * Bring every harness permission file in line with this install: add the rule
 * for the invocation, remove every other rule in the file for the invocation's
 * package, and every such rule from a recorded file whose harness is no longer
 * selected, and record what it wrote.
 *
 * Rules for the other package are neither removed nor dropped from the
 * record: they belong to the other build, which keeps them current on its own
 * runs. An invocation that names neither package (a `self` build's path)
 * removes no package rules at all.
 *
 * With `write: false` it reads the same files and reports the same edits
 * without touching anything, which is what the wizard previews.
 */
export async function syncPermissions(
  cwd: string,
  options: SyncPermissionsOptions
): Promise<PermissionEdit[]> {
  const previous = await readRecords(cwd);
  const own = tasklessPackage(options.invocation);
  const packageOf = (rule: string) => tasklessPackage(commandOfRule(rule));
  const isOwn = (rule: string) => own !== undefined && packageOf(rule) === own;
  const isOther = (rule: string) => {
    const name = packageOf(rule);
    return name !== undefined && name !== own;
  };
  const desired = new Map<string, { harness: Harness; rules: string[] }>();
  for (const harness of harnessesFor(options.selected, options.codexDetected)) {
    desired.set(await harness.locate(cwd), {
      harness,
      rules: [
        ...harness.rules(options.invocation),
        ...(options.launcher === undefined
          ? []
          : harness.rules(options.launcher)),
      ],
    });
  }

  const next: Records = {};
  const edits: PermissionEdit[] = [];
  const files = [...new Set([...Object.keys(previous), ...desired.keys()])];
  for (const file of files.toSorted()) {
    const harness =
      desired.get(file)?.harness ?? HARNESSES.find((h) => h.owns(file));
    const recorded = previous[file];
    if (harness === undefined) {
      if (recorded !== undefined) next[file] = recorded;
      continue;
    }
    const path = join(cwd, file);
    const text = await readText(path);
    const want = desired.get(file)?.rules ?? [];
    const had = recorded?.rules ?? [];
    const remove = harness
      .found(text)
      .filter((rule) => isOwn(rule) && !want.includes(rule));
    const add = want.filter((rule) => !had.includes(rule));
    if (add.length === 0 && remove.length === 0) {
      if (recorded !== undefined) next[file] = recorded;
      continue;
    }

    const created = recorded?.created ?? text === undefined;
    const result = harness.edit(text, add, remove, {
      invocation: options.invocation,
      ...(options.launcher === undefined ? {} : { launcher: options.launcher }),
      created,
    });
    if (result.kind === "skip") {
      if (recorded !== undefined) next[file] = recorded;
      edits.push({
        file,
        created: false,
        allowed: [],
        removed: [],
        skipped: result.reason,
      });
      continue;
    }

    const removed = remove;
    const rules = [
      ...had.filter((rule) => want.includes(rule) || isOther(rule)),
      ...result.added,
    ];
    if (rules.length > 0) next[file] = { rules, created };
    if (result.added.length === 0 && removed.length === 0) continue;
    edits.push({
      file,
      created: text === undefined,
      allowed: result.added,
      removed,
      skipped: null,
    });

    if (!options.write) continue;
    if (result.text === undefined) {
      await rm(path, { force: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, result.text, "utf8");
    }
  }

  if (options.write) await writeRecords(cwd, next);
  return edits;
}

/**
 * The lines that announce each edit. The labels carry the meaning without
 * colour, so the output reads the same under `NO_COLOR` or in a log.
 */
export function describePermissionEdits(
  edits: readonly PermissionEdit[]
): string[] {
  const lines: string[] = [];
  for (const edit of edits) {
    if (edit.skipped !== null) {
      lines.push(chalk.yellow(`SKIPPED: ${edit.file} ${edit.skipped}`));
      continue;
    }
    lines.push(`${edit.created ? "Created" : "Edited"} ${edit.file}`);
    for (const rule of edit.allowed) {
      lines.push(`  ${chalk.green(`ALLOW: ${rule}`)}`);
    }
    for (const rule of edit.removed) {
      lines.push(`  ${chalk.red(`REMOVE: ${rule}`)}`);
    }
  }
  return lines;
}
