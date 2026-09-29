import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import adoptStrayTests, {
  ruleForTestFile,
} from "../src/filesystem/migrations/0010-adopt-stray-tests";

/** The rule id and test name an older CLI wrote, exactly as found in the wild. */
const TIMESTAMPED = "vy-first-param-must-be-is-awesome-20260305-001246";

describe("ruleForTestFile", () => {
  it("matches a test named after the whole id, as older CLIs wrote them", () => {
    expect(ruleForTestFile(`${TIMESTAMPED}-test.yml`, [TIMESTAMPED])).toBe(
      TIMESTAMPED
    );
  });

  it("matches a dated test, as 0005 expected", () => {
    expect(ruleForTestFile("no-eval-20260101-test.yml", ["no-eval"])).toBe(
      "no-eval"
    );
  });

  it("prefers the longest rule id when one id prefixes another", () => {
    expect(
      ruleForTestFile("no-eval-call-20260101-test.yml", [
        "no-eval",
        "no-eval-call",
      ])
    ).toBe("no-eval-call");
  });

  it("matches nothing rather than guessing", () => {
    expect(ruleForTestFile("orphan-test.yml", ["no-eval"])).toBeUndefined();
    expect(ruleForTestFile("notes.md", ["notes"])).toBeUndefined();
  });
});

describe("migration 10: adopting tests 0005 left behind", () => {
  let tasklessDirectory: string;

  beforeEach(async () => {
    tasklessDirectory = join(
      await mkdtemp(join(tmpdir(), "tskl-0010-")),
      ".taskless"
    );
    await mkdir(join(tasklessDirectory, "rules", "sg", TIMESTAMPED), {
      recursive: true,
    });
    await mkdir(join(tasklessDirectory, "sg", "rule-tests"), {
      recursive: true,
    });
    await writeFile(
      join(tasklessDirectory, "sg", "rule-tests", `${TIMESTAMPED}-test.yml`),
      "id: x\n"
    );
  });

  afterEach(async () => {
    await rm(join(tasklessDirectory, ".."), { recursive: true, force: true });
  });

  it("moves the test into the rule's .tests/ and removes the emptied layout", async () => {
    await adoptStrayTests(tasklessDirectory);
    expect(
      await readFile(
        join(
          tasklessDirectory,
          "rules",
          "sg",
          TIMESTAMPED,
          ".tests",
          `${TIMESTAMPED}-test.yml`
        ),
        "utf8"
      )
    ).toBe("id: x\n");
    expect(existsSync(join(tasklessDirectory, "sg"))).toBe(false);
  });

  it("leaves a test that matches no rule, and its directory, where they are", async () => {
    await writeFile(
      join(tasklessDirectory, "sg", "rule-tests", "orphan-test.yml"),
      "id: y\n"
    );
    await adoptStrayTests(tasklessDirectory);
    expect(
      existsSync(join(tasklessDirectory, "sg", "rule-tests", "orphan-test.yml"))
    ).toBe(true);
  });

  it("never overwrites a test the rule already has", async () => {
    const existing = join(
      tasklessDirectory,
      "rules",
      "sg",
      TIMESTAMPED,
      ".tests",
      `${TIMESTAMPED}-test.yml`
    );
    await mkdir(join(existing, ".."), { recursive: true });
    await writeFile(existing, "id: kept\n");
    await adoptStrayTests(tasklessDirectory);
    expect(await readFile(existing, "utf8")).toBe("id: kept\n");
  });

  it("is a no-op on a project with nothing stray", async () => {
    await rm(join(tasklessDirectory, "sg"), { recursive: true });
    await adoptStrayTests(tasklessDirectory);
    expect(
      existsSync(join(tasklessDirectory, "rules", "sg", TIMESTAMPED))
    ).toBe(true);
  });
});

describe("a schema-0 project with timestamped ids, migrated end to end", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "tskl-0010-e2e-"));
    // The layout found in taskless-sandbox/nextjs-sass-starter.
    await mkdir(join(cwd, ".taskless", "rules"), { recursive: true });
    await mkdir(join(cwd, ".taskless", "rule-tests"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "rules", `${TIMESTAMPED}.yml`),
      `id: ${TIMESTAMPED}\nlanguage: TypeScript\nrule:\n  pattern: foo\n`
    );
    await writeFile(
      join(cwd, ".taskless", "rule-tests", `${TIMESTAMPED}-test.yml`),
      `id: ${TIMESTAMPED}\nvalid: []\ninvalid: []\n`
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("files the test inside the rule and leaves no legacy directory", async () => {
    await ensureTasklessDirectory(cwd);
    const rule = join(cwd, ".taskless", "rules", "sg", TIMESTAMPED);
    expect(existsSync(join(rule, `${TIMESTAMPED}.yml`))).toBe(true);
    expect(existsSync(join(rule, ".tests", `${TIMESTAMPED}-test.yml`))).toBe(
      true
    );
    expect(existsSync(join(cwd, ".taskless", "sg"))).toBe(false);
  });
});
