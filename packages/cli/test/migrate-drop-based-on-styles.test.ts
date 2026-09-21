import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { LATEST_SCHEMA_VERSION } from "../src/filesystem/migrate";
import migration, {
  dropBasedOnStyles,
} from "../src/filesystem/migrations/0008-drop-based-on-styles";
import { validateValeRuleConfig } from "../src/schemas/vale-config";

/**
 * Migration 0008 deletes every `BasedOnStyles` line from each Vale rule's
 * `.vale.ini`.
 *
 * `migrate-install.test.ts` proves every prior version reaches the latest
 * counter and never reads a rule config, so a 0008 that stopped rewriting
 * would pass there. This file reads the configs, and holds the rewritten
 * shape to the schema that refuses the old one: the migration exists so an
 * upgraded project's `check` stays green, which is a claim about the schema,
 * not about the bytes.
 */
describe("migration 0008 drops BasedOnStyles from rule configs", () => {
  let directory: string;
  let taskless: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-0008-"));
    taskless = join(directory, ".taskless");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function rule(id: string, config: string): Promise<string> {
    const ruleDirectory = join(taskless, "rules", "vale", id);
    await mkdir(ruleDirectory, { recursive: true });
    const path = join(ruleDirectory, ".vale.ini");
    await writeFile(path, config, "utf8");
    return path;
  }

  const THREE_MATCHERS =
    "# Every markdown file.\n" +
    "[*.md]\n" +
    "tskl) rule = no-simply\n" +
    "BasedOnStyles =\n" +
    "no-simply.no-simply = YES\n" +
    "\n" +
    "[docs/**]\n" +
    "tskl) rule = no-simply\n" +
    "  BasedOnStyles = \n" +
    "no-simply.no-simply = YES\n" +
    "\n" +
    "# The changelog quotes release notes verbatim.\n" +
    "[CHANGELOG.md]\n" +
    "tskl) rule = no-simply\n" +
    "BasedOnStyles = Vale\n" +
    "no-simply.no-simply = NO\n";

  const THREE_MATCHERS_STRIPPED =
    "# Every markdown file.\n" +
    "[*.md]\n" +
    "tskl) rule = no-simply\n" +
    "no-simply.no-simply = YES\n" +
    "\n" +
    "[docs/**]\n" +
    "tskl) rule = no-simply\n" +
    "no-simply.no-simply = YES\n" +
    "\n" +
    "# The changelog quotes release notes verbatim.\n" +
    "[CHANGELOG.md]\n" +
    "tskl) rule = no-simply\n" +
    "no-simply.no-simply = NO\n";

  it("removes the line from every matcher and leaves every other byte", async () => {
    const path = await rule("no-simply", THREE_MATCHERS);
    await migration(taskless);
    expect(await readFile(path, "utf8")).toBe(THREE_MATCHERS_STRIPPED);
  });

  it("produces a config the schema accepts, from one it refuses", async () => {
    // The point of the migration. A rewrite that left the schema unhappy
    // would turn an upgrade into a red `check` on every project.
    expect(
      validateValeRuleConfig("no-simply", THREE_MATCHERS).rejections.map(
        (rejection) => rejection.constraintId
      )
    ).toEqual([
      "vale-config-no-based-on-styles",
      "vale-config-no-based-on-styles",
      "vale-config-no-based-on-styles",
    ]);
    const path = await rule("no-simply", THREE_MATCHERS);
    await migration(taskless);
    const verdict = validateValeRuleConfig(
      "no-simply",
      await readFile(path, "utf8")
    );
    expect(verdict.rejections).toEqual([]);
    expect(verdict.sections).toEqual(["*.md", "docs/**", "CHANGELOG.md"]);
  });

  it("does not rewrite a config without the line", async () => {
    const path = await rule(
      "no-hedging",
      "[*.md]\ntskl) rule = no-hedging\nno-hedging.no-hedging = YES\n"
    );
    const before = await stat(path);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await migration(taskless);
    const after = await stat(path);
    // Untouched, not merely unchanged: a rewrite of identical bytes would
    // still show up in a watcher and in `git status` on some filesystems.
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("leaves a comment that mentions BasedOnStyles alone", async () => {
    const source =
      "# BasedOnStyles = Vale would load a whole bundled style; never write it.\n" +
      "; BasedOnStyles is not a per-rule setting either.\n" +
      "[*.md]\n" +
      "tskl) rule = no-simply\n" +
      "BasedOnStyles =\n" +
      "no-simply.no-simply = YES\n";
    const path = await rule("no-simply", source);
    await migration(taskless);
    expect(await readFile(path, "utf8")).toBe(
      "# BasedOnStyles = Vale would load a whole bundled style; never write it.\n" +
        "; BasedOnStyles is not a per-rule setting either.\n" +
        "[*.md]\n" +
        "tskl) rule = no-simply\n" +
        "no-simply.no-simply = YES\n"
    );
  });

  it("is idempotent", async () => {
    const path = await rule("no-simply", THREE_MATCHERS);
    await migration(taskless);
    const once = await readFile(path, "utf8");
    await migration(taskless);
    expect(await readFile(path, "utf8")).toBe(once);
  });

  it("keeps CRLF line endings and a line with no trailing newline", () => {
    expect(
      dropBasedOnStyles("[*.md]\r\nBasedOnStyles =\r\nr.r = YES\r\n")
    ).toBe("[*.md]\r\nr.r = YES\r\n");
    expect(dropBasedOnStyles("[*.md]\nr.r = YES\nBasedOnStyles =")).toBe(
      "[*.md]\nr.r = YES\n"
    );
  });

  it("does nothing on a project with no Vale rules", async () => {
    await mkdir(taskless, { recursive: true });
    await expect(migration(taskless)).resolves.toBeUndefined();
  });

  it("runs on a version-7 scaffold through the runner and records the latest version", async () => {
    await mkdir(taskless, { recursive: true });
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version: 7, install: {} }),
      "utf8"
    );
    const path = await rule("no-simply", THREE_MATCHERS);

    await ensureTasklessDirectory(directory, { onNotice: () => {} });

    expect(await readFile(path, "utf8")).toBe(THREE_MATCHERS_STRIPPED);
    const manifest = JSON.parse(
      await readFile(join(taskless, "taskless.json"), "utf8")
    ) as { version: number };
    // Latest rather than 8: the runner applies everything above 7, and a
    // literal here is what broke the 0007 test when this migration landed.
    expect(manifest.version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
  });
});
