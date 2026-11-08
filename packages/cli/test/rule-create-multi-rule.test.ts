import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { runCommand } from "citty";

import { ruleCommand } from "../src/commands/rules";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import {
  engineRulesDirectory,
  ruleDirectory,
  ruleFilePath,
} from "../src/rules/engines";
import { servedBody, stubV2Server, type StubRule } from "./support/v2-server";

/**
 * A request that produced several rules is delivered all or nothing: every
 * rule is verified AND checked as a writable rule before the first is written,
 * so a later rule's refusal leaves `.taskless/rules/` exactly as it was (#623).
 * Driven through the real command, so the `--json` envelope is asserted too.
 */

const goodRule: StubRule = {
  id: "first-good-rule",
  engine: "sg",
  files: [
    { path: "tests/fail/case/case.ts", content: "foo();\n" },
    {
      path: "first-good-rule.yml",
      content:
        "id: first-good-rule\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
    },
  ],
};

/** What `first-good-rule` held before the request, which must survive it. */
const EXISTING =
  "id: first-good-rule\nlanguage: TypeScript\nrule:\n  pattern: bar\n";

/** Serve a request that produced `first` (`goodRule` unless named), then `second`. */
async function serve(second: StubRule, first = goodRule): Promise<void> {
  stubV2Server({
    produced: [
      { rule: first, body: await servedBody(first, "rev-1") },
      { rule: second, body: await servedBody(second, "rev-1") },
    ],
  });
}

/** A complete Vale rule, so its write lands in a different engine directory. */
const valeRule: StubRule = {
  id: "second-rule",
  engine: "vale",
  files: [
    { path: "tests/fail/case/case.md", content: "Some text.\n" },
    {
      path: "second-rule.yml",
      content:
        "extends: existence\nmessage: no\nlevel: error\ntokens:\n  - text\n",
    },
    { path: ".vale.ini", content: "[*.md]\nBasedOnStyles = Taskless\n" },
  ],
};

/**
 * Whether a read-only directory actually refuses this process. It does not
 * for root, which CI containers sometimes are, nor on Windows, where `chmod`
 * only toggles the read-only attribute on files.
 */
const readOnlyDirectoriesRefuse =
  process.platform !== "win32" && process.getuid?.() !== 0;

describe("rule create: a request with several rules", () => {
  let cwd: string;
  let logSpy: MockInstance<(...data: unknown[]) => void>;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-rule-multi-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({
        // Current, so nothing migrates the tree before delivery and the
        // seeded rule below is compared where it was written.
        version: LATEST_SCHEMA_VERSION,
        orgId: 123,
        repositoryUrl: "https://github.com/test/test",
      })
    );
    // Seeded in the current rules layout, by the same helpers delivery uses.
    await mkdir(ruleDirectory(cwd, "sg", "first-good-rule"), {
      recursive: true,
    });
    await writeFile(ruleFilePath(cwd, "sg", "first-good-rule"), EXISTING);
    execFileSync("git", ["init"], { cwd });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/test/test.git"],
      { cwd }
    );
    process.env.TASKLESS_TOKEN = "test-token";
    process.env.TASKLESS_API_URL = "https://example.invalid/cli";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "setTimeout",
      (function_: (...arguments_: unknown[]) => void) => {
        function_();
        return 0 as unknown as NodeJS.Timeout;
      }
    );
  });

  afterEach(async () => {
    // A test may leave an engine directory read-only; hand it back so the
    // temporary tree can be removed.
    await chmod(engineRulesDirectory(cwd, "vale"), 0o755).catch(() => {});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.TASKLESS_TOKEN;
    delete process.env.TASKLESS_API_URL;
    await rm(cwd, { recursive: true, force: true });
  });

  /** Every file under `.taskless/rules/`, with its content. */
  async function rulesTree(): Promise<Record<string, string>> {
    const root = join(cwd, ".taskless", "rules");
    const entries = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    });
    const tree: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      tree[relative(root, path)] = await readFile(path, "utf8");
    }
    return tree;
  }

  /**
   * The tree before a request, asserted to hold the seeded rule at its
   * current-layout path, so "unchanged" cannot pass over an empty tree.
   */
  async function seededTree(): Promise<Record<string, string>> {
    const tree = await rulesTree();
    const seeded = relative(
      join(cwd, ".taskless", "rules"),
      ruleFilePath(cwd, "sg", "first-good-rule")
    );
    expect(tree[seeded]).toBe(EXISTING);
    return tree;
  }

  async function create(): Promise<void> {
    const requestFile = join(cwd, "request.json");
    await writeFile(requestFile, JSON.stringify({ prompt: "add rules" }));
    await runCommand(ruleCommand, {
      rawArgs: ["create", "--from", requestFile, "--json", "-d", cwd],
    });
  }

  /** The `--json` envelope the failed command printed last. */
  function envelope(): { code?: string; message?: string } {
    return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      code?: string;
      message?: string;
    };
  }

  it("writes nothing when the second rule's engine is unknown", async () => {
    const before = await seededTree();
    await serve({
      id: "second-rule",
      engine: "semgrep" as StubRule["engine"],
      files: [{ path: "second-rule.yml", content: "rules: []\n" }],
    });

    await expect(create()).rejects.toThrow();
    expect(envelope().code).toBe("RULE_UNSUPPORTED");
    expect(await rulesTree()).toEqual(before);
  });

  it("writes nothing when the second rule delivers an unsafe path", async () => {
    const before = await seededTree();
    await serve({
      id: "second-rule",
      engine: "sg",
      files: [
        {
          path: "second-rule.yml",
          content:
            "id: second-rule\nlanguage: TypeScript\nrule:\n  pattern: baz\n",
        },
        { path: "../escape.yml", content: "escaped\n" },
      ],
    });

    await expect(create()).rejects.toThrow();
    const { code, message } = envelope();
    expect(code).toBe("RULE_GENERATION_FAILED");
    expect(message).toContain("second-rule");
    expect(await rulesTree()).toEqual(before);
    await expect(
      readFile(
        join(ruleDirectory(cwd, "sg", "second-rule"), "..", "escape.yml"),
        "utf8"
      )
    ).rejects.toThrow();
  });

  it("writes nothing when the second rule's file set is incomplete", async () => {
    const before = await seededTree();
    await serve({
      id: "second-rule",
      engine: "sg",
      files: [{ path: "tests/fail/case/case.ts", content: "baz();\n" }],
    });

    await expect(create()).rejects.toThrow();
    const { code, message } = envelope();
    expect(code).toBe("RULE_GENERATION_FAILED");
    expect(message).toContain("second-rule");
    expect(await rulesTree()).toEqual(before);
  });

  it("writes both when both rules pass", async () => {
    const second: StubRule = {
      id: "second-rule",
      engine: "sg",
      files: [
        { path: "tests/fail/case/case.ts", content: "baz();\n" },
        {
          path: "second-rule.yml",
          content:
            "id: second-rule\nlanguage: TypeScript\nrule:\n  pattern: baz\n",
        },
      ],
    };
    await serve(second);

    await create();
    const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      rules?: string[];
    };
    expect(output.rules).toEqual(["first-good-rule", "second-rule"]);
    expect(
      await readFile(ruleFilePath(cwd, "sg", "first-good-rule"), "utf8")
    ).toBe(goodRule.files[1]?.content);
    expect(await readFile(ruleFilePath(cwd, "sg", "second-rule"), "utf8")).toBe(
      second.files[1]?.content
    );
  });

  /**
   * An IO failure on the second rule's write, after both rules passed every
   * check: `.taskless/rules/vale/` is read-only, so the Vale rule cannot be
   * moved into place, and the `sg` rule committed before it must be undone.
   */
  async function failSecondWrite(): Promise<void> {
    await mkdir(engineRulesDirectory(cwd, "vale"), { recursive: true });
    await chmod(engineRulesDirectory(cwd, "vale"), 0o555);
  }

  /** Any staging directory a delivery left inside `.taskless/`. */
  async function leftovers(): Promise<string[]> {
    const entries = await readdir(join(cwd, ".taskless"));
    return entries.filter((name) => name.startsWith(".tmp-delivery-"));
  }

  it.skipIf(!readOnlyDirectoriesRefuse)(
    "restores an overwritten rule when a later write fails",
    async () => {
      // A stray beside the seeded rule, so the restore is shown to bring back
      // the whole old directory and not only the file being replaced.
      const stray = join(
        ruleDirectory(cwd, "sg", "first-good-rule"),
        "tests",
        "pass",
        "old",
        "case.ts"
      );
      await mkdir(join(stray, ".."), { recursive: true });
      await writeFile(stray, "bar();\n");
      const before = await seededTree();
      await serve(valeRule);
      await failSecondWrite();

      await expect(create()).rejects.toThrow();
      const { code, message } = envelope();
      expect(code).toBe("RULE_GENERATION_FAILED");
      expect(message).toContain('Rule "second-rule" could not be written');
      expect(message).toContain("EACCES");
      expect(await rulesTree()).toEqual(before);
      expect(await leftovers()).toEqual([]);
    }
  );

  it.skipIf(!readOnlyDirectoriesRefuse)(
    "removes a new rule when a later write fails",
    async () => {
      const before = await seededTree();
      const newRule: StubRule = {
        id: "brand-new-rule",
        engine: "sg",
        files: [
          { path: "tests/fail/case/case.ts", content: "foo();\n" },
          {
            path: "brand-new-rule.yml",
            content:
              "id: brand-new-rule\nlanguage: TypeScript\nrule:\n  pattern: foo\n",
          },
        ],
      };
      await serve(valeRule, newRule);
      await failSecondWrite();

      await expect(create()).rejects.toThrow();
      expect(envelope().code).toBe("RULE_GENERATION_FAILED");
      expect(await rulesTree()).toEqual(before);
      await expect(
        readdir(ruleDirectory(cwd, "sg", "brand-new-rule"))
      ).rejects.toThrow();
      expect(await leftovers()).toEqual([]);
    }
  );
});
