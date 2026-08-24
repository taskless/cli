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

import { assembleSgConfig, assembleValeConfig } from "../src/rules/assemble";
import { ruleDirectory, ruleTestsDirectory } from "../src/rules/engines";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "tskl-assemble-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** Lay down a Vale rule with its own config. */
async function valeRule(id: string, config: string): Promise<void> {
  const directory = ruleDirectory(cwd, "vale", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `extends: existence\nmessage: "x"\nlevel: warning\ntokens:\n  - x\n`
  );
  await writeFile(join(directory, ".vale.ini"), config);
}

/** Lay down an ast-grep rule with a test file. */
async function sgRule(id: string): Promise<void> {
  await sgRuleWithoutTests(id);
  await mkdir(ruleTestsDirectory(cwd, "sg", id), { recursive: true });
}

/**
 * Lay down an ast-grep rule that has no `.tests/` at all.
 *
 * The state a nightly-migrated project is in, and the state a hand-made
 * `mkdir .taskless/rules/sg/<id>/` reaches on any version.
 */
async function sgRuleWithoutTests(id: string): Promise<void> {
  const directory = ruleDirectory(cwd, "sg", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yml`),
    `id: ${id}\nlanguage: TypeScript\nseverity: error\nmessage: x\nrule:\n  pattern: eval($A)\n`
  );
}

describe("Vale config assembly", () => {
  it("writes a header naming the Vale rules tree as StylesPath", async () => {
    await valeRule("no-simply", "[*.md]\nno-simply.no-simply = YES\n");
    const path = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");

    // StylesPath is what makes `<id>/<id>.yml` resolve as check `<id>.<id>`.
    // Under `.` it resolves to nothing at all, so this line is the difference
    // between every rule running and every rule silently disabled.
    expect(contents).toContain("StylesPath = rules/vale");
    expect(contents).toContain("MinAlertLevel = suggestion");
  });

  // Vale's matcher precedence is positional, so an assembly ordered by
  // directory iteration would give a rule a different effective scope
  // depending on the machine it ran on.
  it("emits rules in sorted id order", async () => {
    await valeRule("zebra", "[*.md]\nzebra.zebra = YES\n");
    await valeRule("alpha", "[*.md]\nalpha.alpha = YES\n");

    const path = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");
    expect(contents.indexOf("alpha.alpha")).toBeLessThan(
      contents.indexOf("zebra.zebra")
    );
  });

  it("is byte-identical across runs", async () => {
    await valeRule("one", "[*.md]\none.one = YES\n");
    await valeRule("two", "[docs/**]\ntwo.two = YES\n");

    const first = await assembleValeConfig(cwd);
    const a = await readFile(join(cwd, first ?? ""), "utf8");
    const second = await assembleValeConfig(cwd);
    const b = await readFile(join(cwd, second ?? ""), "utf8");
    expect(a).toBe(b);
  });

  // A rule's matcher order is the author's expression of precedence — a
  // disable declared after the enable it narrows. Reordering silently changes
  // scope, so assembly copies each rule's block verbatim.
  it("preserves each rule's own matcher order", async () => {
    await valeRule(
      "scoped",
      "[marketing/**]\nscoped.scoped = YES\n\n[marketing/legacy/**]\nscoped.scoped = NO\n"
    );
    const path = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");
    expect(contents.indexOf("[marketing/**]")).toBeLessThan(
      contents.indexOf("[marketing/legacy/**]")
    );
  });

  it("tags each block with the rule it came from", async () => {
    await valeRule("no-simply", "[*.md]\nno-simply.no-simply = YES\n");
    const path = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");
    // Provenance is otherwise lost the moment two rules' matchers interleave.
    expect(contents).toContain("tskl) rule = no-simply");
  });

  // A per-rule StylesPath would either duplicate the header or silently fight
  // it, and it is a property of the run rather than of a rule.
  it("drops a StylesPath an author copied into a rule config", async () => {
    await valeRule(
      "no-simply",
      "StylesPath = .\nMinAlertLevel = error\n\n[*.md]\nno-simply.no-simply = YES\n"
    );
    const path = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");
    expect(contents).not.toContain("StylesPath = .");
    expect(contents).not.toContain("MinAlertLevel = error");
  });

  // Writing an empty config would have Vale lint the project against no rules
  // and report a clean pass, which is indistinguishable from a passing check.
  it("writes nothing when no rule declares a config", async () => {
    expect(await assembleValeConfig(cwd)).toBeUndefined();
  });
});

describe("ast-grep config assembly", () => {
  it("points ruleDirs at the sg tree and testConfigs at each rule", async () => {
    await sgRule("no-eval");
    await sgRule("no-debugger");

    const path = await assembleSgConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");

    expect(contents).toContain("ruleDirs:\n  - rules/sg");
    // Each rule keeps its tests inside its own directory, so each needs its
    // own testConfigs entry.
    expect(contents).toContain("- testDir: rules/sg/no-debugger/.tests");
    expect(contents).toContain("- testDir: rules/sg/no-eval/.tests");
  });

  it("is byte-identical across runs", async () => {
    await sgRule("b-rule");
    await sgRule("a-rule");
    const first = await assembleSgConfig(cwd);
    const a = await readFile(join(cwd, first ?? ""), "utf8");
    await assembleSgConfig(cwd);
    const b = await readFile(join(cwd, first ?? ""), "utf8");
    expect(a).toBe(b);
  });

  it("writes nothing when there are no ast-grep rules", async () => {
    expect(await assembleSgConfig(cwd)).toBeUndefined();
  });

  // ast-grep 0.41.0 aborts the whole invocation on a `testDir` it cannot read
  // (exit 6), and `--filter` does not scope that away — so a single rule with
  // no `.tests/` would fail every *other* rule's test run, naming a rule its
  // author never touched.
  it("omits a testDir whose directory is not on disk", async () => {
    await sgRule("has-tests");
    await sgRuleWithoutTests("no-tests");

    const path = await assembleSgConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");

    expect(contents).toContain("- testDir: rules/sg/has-tests/.tests");
    expect(contents).not.toContain("no-tests");
  });

  it("emits no testDir that is missing from disk, for any rule", async () => {
    await sgRule("alpha");
    await sgRuleWithoutTests("beta");
    await sgRule("gamma");

    const path = await assembleSgConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");

    const prefix = "  - testDir: ";
    const emitted = contents
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length));
    expect(emitted.length).toBeGreaterThan(0);
    for (const directory of emitted) {
      const stats = await stat(join(cwd, ".taskless", directory));
      expect(stats.isDirectory(), `${directory} is a directory`).toBe(true);
    }
  });

  // `testConfigs:` with no entries under it is accepted by ast-grep 0.41.0 —
  // measured for both `sg test` and `sg scan` — so a project where no rule has
  // tests yet still gets a config both commands can read.
  it("still emits a config when no rule has a tests directory", async () => {
    await sgRuleWithoutTests("only-rule");

    const path = await assembleSgConfig(cwd);
    const contents = await readFile(join(cwd, path ?? ""), "utf8");

    expect(contents).toBe("ruleDirs:\n  - rules/sg\ntestConfigs:\n");
  });
});
