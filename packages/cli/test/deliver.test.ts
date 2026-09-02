import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeRuleFile } from "../src/rules/files";
import { PurgeIncompleteError } from "../src/rules/deliver";
import { ruleDirectory } from "../src/rules/engines";
import type { GeneratedRule } from "../src/api/rules";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "deliver-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** A delivered rule carrying a file set, shaped as the contract describes. */
function delivered(
  engine: string,
  id: string,
  files: { path: string; content: string }[]
): GeneratedRule {
  return { id, engine, files } as unknown as GeneratedRule;
}

const CAPTURE = [
  "id: logs-abc12345",
  "language: typescript",
  "rule:",
  "  pattern: console.log($A)",
  "metadata:",
  "  taskless:",
  "    version: 1",
  "    kind: runtime",
  "    name: logs",
  "    check: check.ts",
  "",
].join("\n");

describe("delivering a rule as a file set", () => {
  it("writes a complete runtime rule", async () => {
    await writeRuleFile(
      cwd,
      delivered("runtime", "logs-abc12345", [
        { path: "check.ts", content: "export default async () => [];\n" },
        { path: "captures/logs.yml", content: CAPTURE },
        { path: ".tests/valid/sample.ts", content: "const x = 1;\n" },
      ])
    );

    const directory = ruleDirectory(cwd, "runtime", "logs-abc12345");
    expect(existsSync(join(directory, "check.ts"))).toBe(true);
    // Nested paths create their parents; a capture is not written flat.
    await expect(
      readFile(join(directory, "captures", "logs.yml"), "utf8")
    ).resolves.toContain("kind: runtime");
    expect(existsSync(join(directory, ".tests", "valid", "sample.ts"))).toBe(
      true
    );
  });

  it("writes a Vale rule with its own config", async () => {
    // G2: the generator owns the `.vale.ini`, because it holds the scope
    // knowledge and the client cannot infer it from the rule YAML.
    await writeRuleFile(
      cwd,
      delivered("vale", "no-click-here-abc12345", [
        {
          path: "no-click-here-abc12345.yml",
          content:
            "extends: existence\nmessage: no\nlevel: warning\ntokens:\n  - click here\n",
        },
        {
          path: ".vale.ini",
          content:
            "[*.md]\nno-click-here-abc12345.no-click-here-abc12345 = YES\n",
        },
      ])
    );
    const directory = ruleDirectory(cwd, "vale", "no-click-here-abc12345");
    await expect(
      readFile(join(directory, ".vale.ini"), "utf8")
    ).resolves.toContain("[*.md]");
  });

  // Every path that must never reach the filesystem. The service names
  // locations on a developer's disk now, which it never did while the response
  // carried one structured object.
  it.each([
    ["absolute", "/etc/passwd"],
    ["parent traversal", "../../../../etc/passwd"],
    ["traversal mid-path", "captures/../../escape.yml"],
    ["backslash", String.raw`captures\logs.yml`],
    ["empty", ""],
    ["bare dot segment", "./check.ts"],
  ])("refuses a %s path and writes nothing", async (_label, path) => {
    const rule = delivered("runtime", "logs-abc12345", [
      { path: "check.ts", content: "export default async () => [];\n" },
      { path: "captures/logs.yml", content: CAPTURE },
      { path, content: "owned\n" },
    ]);

    await expect(writeRuleFile(cwd, rule)).rejects.toThrow(/path that/);

    // Refused as a unit: not one file of it exists, including the files that
    // were themselves fine. A half-written rule verifies as a broken rule two
    // steps from the cause.
    expect(existsSync(ruleDirectory(cwd, "runtime", "logs-abc12345"))).toBe(
      false
    );
  });

  it("refuses a runtime rule with no check.ts", async () => {
    await expect(
      writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", [
          { path: "captures/logs.yml", content: CAPTURE },
        ])
      )
    ).rejects.toThrow(/no check\.ts/);
  });

  it("refuses a runtime rule with no captures", async () => {
    await expect(
      writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", [
          { path: "check.ts", content: "export default async () => [];\n" },
        ])
      )
    ).rejects.toThrow(/no capture rules under captures\//);
  });

  it("refuses a Vale rule with no .vale.ini", async () => {
    // Without it no matcher enables the rule: it would be written, verified,
    // and never fire.
    await expect(
      writeRuleFile(
        cwd,
        delivered("vale", "no-click-here-abc12345", [
          {
            path: "no-click-here-abc12345.yml",
            content: "extends: existence\n",
          },
        ])
      )
    ).rejects.toThrow(/no \.vale\.ini/);
  });

  it("refuses the same path twice", async () => {
    await expect(
      writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", [
          { path: "check.ts", content: "a\n" },
          { path: "captures/logs.yml", content: CAPTURE },
          { path: "check.ts", content: "b\n" },
        ])
      )
    ).rejects.toThrow(/twice/);
  });

  it.each([
    // Either order fails mid-write, differently: `mkdir` throws ENOTDIR when
    // the parent was already written as a file, `writeFile` throws EISDIR when
    // a recursive mkdir got there first.
    ["file before directory", ["check.ts", "check.ts/nested.ts"]],
    ["directory before file", ["check.ts/nested.ts", "check.ts"]],
  ])(
    "refuses a path that is an ancestor of another (%s)",
    async (_label, [first, second]) => {
      await expect(
        writeRuleFile(
          cwd,
          delivered("runtime", "logs-abc12345", [
            { path: first as string, content: "a\n" },
            { path: second as string, content: "b\n" },
            { path: "captures/logs.yml", content: CAPTURE },
          ])
        )
      ).rejects.toThrow(/both a file and a directory/);

      expect(existsSync(ruleDirectory(cwd, "runtime", "logs-abc12345"))).toBe(
        false
      );
    }
  );

  it("refuses two capture paths differing only in case", async () => {
    // On APFS and NTFS these are one file: the second write clobbers the
    // first, and the rule loses a capture nobody was told was dropped.
    await expect(
      writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", [
          { path: "check.ts", content: "export default async () => [];\n" },
          { path: "captures/logs.yml", content: CAPTURE },
          { path: "captures/Logs.yml", content: CAPTURE },
        ])
      )
    ).rejects.toThrow(/differing only in case/);
  });

  // A malformed set used to normalize to `[]` and report "delivered no files"
  // for a payload that delivered several, sending anyone debugging a real
  // shape defect to look in the wrong place.
  it.each([
    ["files is not an array", "nope", /files` that is not an array/],
    [
      "an entry is not an object",
      ["check.ts"],
      /files\[0\]` that is not an object/,
    ],
    [
      "an entry has no path",
      [{ content: "x\n" }],
      /files\[0\]` with no string `path`/,
    ],
    [
      "an entry has no content",
      [{ path: "check.ts" }],
      /`check\.ts` with no string `content`/,
    ],
  ])("names the defect when %s", async (_label, files, expected) => {
    const rule = {
      id: "logs-abc12345",
      engine: "runtime",
      files,
    } as unknown as GeneratedRule;
    await expect(writeRuleFile(cwd, rule)).rejects.toThrow(expected);
    expect(existsSync(ruleDirectory(cwd, "runtime", "logs-abc12345"))).toBe(
      false
    );
  });

  it("refuses a payload carrying both files and content", async () => {
    const rule = {
      id: "logs-abc12345",
      engine: "runtime",
      content: { id: "logs-abc12345", language: "typescript", rule: {} },
      files: [{ path: "check.ts", content: "x\n" }],
    } as unknown as GeneratedRule;
    await expect(writeRuleFile(cwd, rule)).rejects.toThrow(
      /mutually exclusive/
    );
  });

  it.each([
    ["content is null", { id: "no-eval-abc12345", content: null }],
    ["content is a string", { id: "no-eval-abc12345", content: "rule: {}" }],
    ["content is a number", { id: "no-eval-abc12345", content: 0 }],
  ])("refuses a payload where %s", async (_label, rule) => {
    // `yaml` renders every one of these as a scalar document rather than
    // throwing, so without this the rule file is created and its entire
    // contents are `null`, `rule: {}` or `0`. The mutual-exclusion check above
    // treats a present-but-null `content` as "the service sent both", which is
    // the right answer to a different question; this asks whether the value can
    // be written at all.
    await expect(
      writeRuleFile(cwd, rule as unknown as GeneratedRule)
    ).rejects.toThrow(/no usable `content`/);
    expect(existsSync(ruleDirectory(cwd, "sg", "no-eval-abc12345"))).toBe(
      false
    );
  });

  it("refuses a payload carrying neither files nor content", async () => {
    // Before the published union forced the variants apart, this fell through
    // to the single-content branch and handed `stringify` an `undefined`,
    // which returns the STRING "undefined" rather than throwing. The rule file
    // was written, and what it contained was the word undefined.
    const rule = { id: "no-eval-abc12345" } as unknown as GeneratedRule;
    await expect(writeRuleFile(cwd, rule)).rejects.toThrow(
      /no usable `content`/
    );
    expect(existsSync(ruleDirectory(cwd, "sg", "no-eval-abc12345"))).toBe(
      false
    );
  });

  it("still writes a legacy single-content payload", async () => {
    // The envelope every published CLI receives, and will keep receiving.
    const rule = {
      id: "no-eval-abc12345",
      content: { id: "no-eval-abc12345", language: "typescript", rule: {} },
    } as unknown as GeneratedRule;
    const written = await writeRuleFile(cwd, rule);
    expect(written).toBe(
      join(ruleDirectory(cwd, "sg", "no-eval-abc12345"), "no-eval-abc12345.yml")
    );
    const entries = await readdir(ruleDirectory(cwd, "sg", "no-eval-abc12345"));
    expect(entries).toEqual(["no-eval-abc12345.yml"]);
  });
});

/**
 * The set is the directory, not an overlay on it.
 *
 * `files` is "every file the rule directory must contain", so a file the set
 * does not name is not part of the rule. It used to survive the write, which
 * mattered most in `check`'s repair: only `check.ts` is signed, so a stray
 * capture is never reported by reconcile, was never replaced, and went on
 * changing what the rule matched while the rule read as repaired.
 */
describe("a delivered set defines what the rule directory contains", () => {
  /** A complete runtime rule, as a delivery would send it. */
  const COMPLETE = [
    { path: "check.ts", content: "export default async () => [];\n" },
    { path: "captures/logs.yml", content: CAPTURE },
  ];

  async function writeComplete(): Promise<string> {
    await writeRuleFile(cwd, delivered("runtime", "logs-abc12345", COMPLETE));
    return ruleDirectory(cwd, "runtime", "logs-abc12345");
  }

  it("removes a stray capture the set does not name", async () => {
    const directory = await writeComplete();
    // The exact defect: a second capture beside the blessed one. Nothing
    // signs it, reconcile never mentions it, and ast-grep runs it anyway.
    await writeFile(
      join(directory, "captures", "stray.yml"),
      CAPTURE.replace("logs-abc12345", "stray-abc12345"),
      "utf8"
    );

    await writeComplete();

    expect(existsSync(join(directory, "captures", "stray.yml"))).toBe(false);
    // And the rule is whole. A purge that leaves the rule inert is the bug,
    // not the trade-off.
    expect(existsSync(join(directory, "check.ts"))).toBe(true);
    expect(existsSync(join(directory, "captures", "logs.yml"))).toBe(true);
  });

  it("removes a stray module beside check.ts, and prunes emptied directories", async () => {
    const directory = await writeComplete();
    await mkdir(join(directory, "lib"), { recursive: true });
    await writeFile(
      join(directory, "lib", "helper.ts"),
      "export {};\n",
      "utf8"
    );
    await writeFile(join(directory, "notes.md"), "scratch\n", "utf8");

    await writeComplete();

    expect(existsSync(join(directory, "notes.md"))).toBe(false);
    expect(existsSync(join(directory, "lib", "helper.ts"))).toBe(false);
    // The directory goes too. An empty `lib/` left behind is a directory the
    // set never described, and the next reader has to wonder what was in it.
    expect(existsSync(join(directory, "lib"))).toBe(false);
    // `captures/` still holds a delivered file, so it survives: `rmdir`
    // refuses a non-empty directory rather than the purge tracking that.
    expect(existsSync(join(directory, "captures", "logs.yml"))).toBe(true);
  });

  it("keeps .tests/ fixtures the set does not mention", async () => {
    // The stated exception. Nothing under `.tests/` reaches an engine (the dot
    // is what makes ast-grep skip it), and this CLI writes timestamped
    // fixtures there itself that no delivered set will ever name. Purging them
    // would delete a rule's local test history on its first file-set delivery.
    const directory = await writeComplete();
    await mkdir(join(directory, ".tests", "valid"), { recursive: true });
    await writeFile(
      join(directory, ".tests", "logs-abc12345-1970-test.yml"),
      "id: logs-abc12345\n",
      "utf8"
    );
    await writeFile(
      join(directory, ".tests", "valid", "sample.ts"),
      "const x = 1;\n",
      "utf8"
    );

    await writeComplete();

    expect(
      existsSync(join(directory, ".tests", "logs-abc12345-1970-test.yml"))
    ).toBe(true);
    expect(existsSync(join(directory, ".tests", "valid", "sample.ts"))).toBe(
      true
    );
  });

  it("purges a nested .tests/, which is not the rule's test directory", async () => {
    // `RULE_TESTS_DIRECTORY` is defined relative to the rule directory. A
    // `captures/.tests/` is a file an engine reads, not a fixture directory,
    // and exempting it by name alone would leave a hiding place.
    const directory = await writeComplete();
    await mkdir(join(directory, "captures", ".tests"), { recursive: true });
    await writeFile(
      join(directory, "captures", ".tests", "sneaky.yml"),
      CAPTURE,
      "utf8"
    );

    await writeComplete();

    expect(existsSync(join(directory, "captures", ".tests"))).toBe(false);
  });

  it("removes a symlink without following it", async () => {
    const directory = await writeComplete();
    const outside = join(cwd, "outside.txt");
    await writeFile(outside, "untouched\n", "utf8");
    await symlink(outside, join(directory, "link.txt"));

    await writeComplete();

    expect(existsSync(join(directory, "link.txt"))).toBe(false);
    // Only the link was unlinked. Deletion is bounded to the rule directory,
    // and a link is not a licence to reach outside it.
    await expect(readFile(outside, "utf8")).resolves.toBe("untouched\n");
  });

  it("leaves the directory untouched when the set is refused", async () => {
    const directory = await writeComplete();
    await writeFile(join(directory, "stray.md"), "kept\n", "utf8");

    // Assess and purge are a unit, the same way assess and write already were.
    // A refused set must not be the reason a directory is half emptied.
    await expect(
      writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", [
          ...COMPLETE,
          { path: "../escape.yml", content: "owned\n" },
        ])
      )
    ).rejects.toThrow(/path that/);

    expect(existsSync(join(directory, "stray.md"))).toBe(true);
    expect(existsSync(join(directory, "check.ts"))).toBe(true);
  });

  it("refuses to deliver into a symlinked rule directory", async () => {
    // `mkdir` with `recursive` accepts a link to an existing directory and
    // `writeFile` writes through it, so a link standing where the rule
    // directory belongs would put the blessed bytes outside the boundary and
    // hand the purge whatever the link points at. `describeUnsafePath` cannot
    // see it: it resolves delivered paths against this directory as a string,
    // and every one of them is legitimately inside it.
    const directory = ruleDirectory(cwd, "runtime", "logs-abc12345");
    const outside = join(cwd, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep.txt"), "untouched\n", "utf8");
    await mkdir(dirname(directory), { recursive: true });
    await symlink(outside, directory);

    await expect(
      writeRuleFile(cwd, delivered("runtime", "logs-abc12345", COMPLETE))
    ).rejects.toThrow(/symlink/);

    // Nothing written through the link, and the link itself is left for a
    // person to resolve rather than silently deleted: the set describes what
    // is IN the rule directory, not what the directory is.
    expect(existsSync(join(outside, "check.ts"))).toBe(false);
    await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe(
      "untouched\n"
    );
  });

  it("replaces a symlinked directory component instead of writing through it", async () => {
    const directory = await writeComplete();
    const outside = join(cwd, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "logs.yml"), "untouched\n", "utf8");
    await rm(join(directory, "captures"), { recursive: true, force: true });
    await symlink(outside, join(directory, "captures"));

    await writeComplete();

    // The link is unlinked, exactly as the purge would treat it, and only the
    // link: the directory it pointed at keeps its file.
    await expect(readFile(join(outside, "logs.yml"), "utf8")).resolves.toBe(
      "untouched\n"
    );
    const captures = await lstat(join(directory, "captures"));
    expect(captures.isSymbolicLink()).toBe(false);
    // And the capture landed inside the rule directory. Writing it through
    // the link would have left the rule with no capture: it verifies as
    // incomplete and never fires.
    await expect(
      readFile(join(directory, "captures", "logs.yml"), "utf8")
    ).resolves.toBe(CAPTURE);
  });

  it("replaces a symlinked rule file instead of writing through it", async () => {
    const directory = await writeComplete();
    const outside = join(cwd, "outside.ts");
    await writeFile(outside, "untouched\n", "utf8");
    await rm(join(directory, "check.ts"), { force: true });
    await symlink(outside, join(directory, "check.ts"));

    await writeComplete();

    await expect(readFile(outside, "utf8")).resolves.toBe("untouched\n");
    await expect(readFile(join(directory, "check.ts"), "utf8")).resolves.toBe(
      "export default async () => [];\n"
    );
  });

  it("does not purge on the single-content envelope", async () => {
    // There is no set to be authoritative about, so the legacy path keeps
    // overwriting one file and touching nothing else.
    const rule = {
      id: "no-eval-abc12345",
      content: { id: "no-eval-abc12345", language: "typescript", rule: {} },
    } as unknown as GeneratedRule;
    await writeRuleFile(cwd, rule);
    const directory = ruleDirectory(cwd, "sg", "no-eval-abc12345");
    await writeFile(join(directory, "hand-written.yml"), "kept\n", "utf8");

    await writeRuleFile(cwd, rule);

    expect(existsSync(join(directory, "hand-written.yml"))).toBe(true);
  });
});

/**
 * A removal that fails is reported, and does not abandon the rest of the pass.
 *
 * Skipped as root, which ignores the permission bits the failure is staged
 * with. The same convention as `vale-verify.test.ts`.
 */
const asUser = process.getuid?.() === 0 ? describe.skip : describe;

asUser("a purge that cannot finish", () => {
  const COMPLETE = [
    { path: "check.ts", content: "export default async () => [];\n" },
    { path: "captures/logs.yml", content: CAPTURE },
  ];

  it("removes what it can, and names what it could not", async () => {
    await writeRuleFile(cwd, delivered("runtime", "logs-abc12345", COMPLETE));
    const directory = ruleDirectory(cwd, "runtime", "logs-abc12345");
    // A stray whose parent denies unlinking, plus an ordinary one. `rm` with
    // `force` swallows only `ENOENT`, so the first is a genuine failure.
    await mkdir(join(directory, "blocked"), { recursive: true });
    await writeFile(join(directory, "blocked", "a.txt"), "stuck\n", "utf8");
    await writeFile(join(directory, "notes.md"), "scratch\n", "utf8");
    await chmod(join(directory, "blocked"), 0o500);

    try {
      await expect(
        writeRuleFile(cwd, delivered("runtime", "logs-abc12345", COMPLETE))
      ).rejects.toThrow(/could not remove.*blocked\/a\.txt/s);

      // The rest of the pass still ran. Abandoning it at the first failure
      // left later strays in place for no reason other than `readdir` order,
      // so the same directory purged differently on two machines.
      expect(existsSync(join(directory, "notes.md"))).toBe(false);
      // And the rule itself is complete: writes come first, so a failed purge
      // is a named leftover beside a working rule, never a missing piece.
      expect(existsSync(join(directory, "check.ts"))).toBe(true);
      expect(existsSync(join(directory, "captures", "logs.yml"))).toBe(true);
    } finally {
      await chmod(join(directory, "blocked"), 0o700);
    }
  });

  it("is a distinct error type, so a caller need not read the message", async () => {
    // The reason this is typed. A failed WRITE and a failed CLEANUP ask the
    // reader for opposite things — "the rule is not there" versus "the rule
    // IS there and something stale is too" — and a caller that could only
    // match on prose gets it wrong the first time the wording changes.
    await writeRuleFile(cwd, delivered("runtime", "logs-abc12345", COMPLETE));
    const directory = ruleDirectory(cwd, "runtime", "logs-abc12345");
    await mkdir(join(directory, "blocked"), { recursive: true });
    await writeFile(join(directory, "blocked", "a.txt"), "stuck\n", "utf8");
    await chmod(join(directory, "blocked"), 0o500);

    try {
      const error = await writeRuleFile(
        cwd,
        delivered("runtime", "logs-abc12345", COMPLETE)
      ).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(PurgeIncompleteError);
      expect((error as PurgeIncompleteError).failures).toHaveLength(1);
      expect((error as PurgeIncompleteError).failures[0]).toContain(
        "blocked/a.txt"
      );
    } finally {
      await chmod(join(directory, "blocked"), 0o700);
    }
  });
});
