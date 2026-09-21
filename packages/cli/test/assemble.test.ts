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

import {
  assembleSgConfig,
  assembleValeConfig,
  type ValeAssembly,
} from "../src/rules/assemble";
import { ruleDirectory, ruleTestsDirectory } from "../src/rules/engines";

let cwd: string;

/** The written config's path, failing loudly when assembly did not write one. */
function okPath(assembled: ValeAssembly | undefined): string {
  if (assembled?.status !== "ok") {
    throw new Error(
      `expected an assembled config, got ${JSON.stringify(assembled)}`
    );
  }
  return assembled.path;
}

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
    await valeRule(
      "no-simply",
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    const assembled = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, okPath(assembled)), "utf8");

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
    await valeRule("zebra", "[*.md]\ntskl) rule = zebra\nzebra.zebra = YES\n");
    await valeRule("alpha", "[*.md]\ntskl) rule = alpha\nalpha.alpha = YES\n");

    const assembled = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, okPath(assembled)), "utf8");
    expect(contents.indexOf("alpha.alpha")).toBeLessThan(
      contents.indexOf("zebra.zebra")
    );
  });

  it("is byte-identical across runs", async () => {
    await valeRule("one", "[*.md]\ntskl) rule = one\none.one = YES\n");
    await valeRule("two", "[docs/**]\ntskl) rule = two\ntwo.two = YES\n");

    const first = await assembleValeConfig(cwd);
    const a = await readFile(join(cwd, okPath(first)), "utf8");
    const second = await assembleValeConfig(cwd);
    const b = await readFile(join(cwd, okPath(second)), "utf8");
    expect(a).toBe(b);
  });

  // A rule's matcher order is the author's expression of precedence — a
  // disable declared after the enable it narrows. Reordering silently changes
  // scope, so assembly copies each rule's block verbatim.
  it("preserves each rule's own matcher order", async () => {
    await valeRule(
      "scoped",
      "[marketing/**]\ntskl) rule = scoped\nscoped.scoped = YES\n\n[marketing/legacy/**]\ntskl) rule = scoped\nscoped.scoped = NO\n"
    );
    const assembled = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, okPath(assembled)), "utf8");
    expect(contents.indexOf("[marketing/**]")).toBeLessThan(
      contents.indexOf("[marketing/legacy/**]")
    );
  });

  it("tags each block with the rule it came from", async () => {
    await valeRule(
      "no-simply",
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    const assembled = await assembleValeConfig(cwd);
    const contents = await readFile(join(cwd, okPath(assembled)), "utf8");
    // Provenance is otherwise lost the moment two rules' matchers interleave.
    expect(contents).toContain("tskl) rule = no-simply");
  });

  // A per-rule StylesPath would either duplicate the header or silently fight
  // it, and it is a property of the run rather than of a rule. Assembly used
  // to strip it; now the schema rejects it, and assembly refuses rather than
  // edits, because the file Vale reads has to be the file the author wrote.
  it("refuses a StylesPath an author copied into a rule config", async () => {
    await valeRule(
      "no-simply",
      "StylesPath = .\nMinAlertLevel = error\n\n[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("refused");
    if (assembled?.status !== "refused") return;
    expect(assembled.refusals.map((refusal) => refusal.ruleId)).toEqual([
      "no-simply",
    ]);
    expect(
      assembled.refusals[0]?.rejections.map((r) => r.constraintId)
    ).toContain("vale-config-no-root-keys");
    expect(assembled.refusals[0]?.rejections[0]?.message).toContain(
      "no-simply/.vale.ini line 1:"
    );
  });

  // Refused means refused: nothing on disk. A stale config left behind from an
  // earlier run would let Vale lint against yesterday's rules and report them
  // as today's.
  it("leaves the assembled config unwritten when a rule assigns a foreign key", async () => {
    await valeRule(
      "no-hedging",
      "[*.md]\ntskl) rule = no-hedging\nno-hedging.no-hedging = YES\n"
    );
    await valeRule(
      "no-simply",
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\nno-hedging.no-hedging = NO\n"
    );
    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("refused");
    if (assembled?.status !== "refused") return;
    // Only the rule that broke the schema is named; its neighbour is fine.
    expect(assembled.refusals.map((refusal) => refusal.ruleId)).toEqual([
      "no-simply",
    ]);
    expect(assembled.refusals[0]?.rejections[0]?.constraintId).toBe(
      "vale-config-own-key-only"
    );
    expect(assembled.refusals[0]?.rejections[0]?.message).toContain("line 4");
    await expect(stat(join(cwd, ".taskless", ".vale.ini"))).rejects.toThrow();
  });

  // Every refused rule is reported at once. An author with two broken configs
  // should not fix one, re-run, and only then hear about the other.
  it("names every refused rule, not just the first", async () => {
    await valeRule("alpha", "alpha.alpha = YES\n");
    await valeRule("beta", "[*.md]\ntskl) rule = beta\nbeta.beta = NO\n");
    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("refused");
    if (assembled?.status !== "refused") return;
    expect(assembled.refusals.map((refusal) => refusal.ruleId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  // The config is the generator's structured input and is never re-serialized:
  // the schema reads it as an AST, Vale reads the author's own bytes.
  it("writes an accepted config verbatim under its breadcrumb", async () => {
    const source =
      "# scope\n[docs/**]\ntskl) rule = no-simply\nBasedOnStyles =\n\nno-simply.no-simply = YES   \n";
    await valeRule("no-simply", source);
    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("ok");
    if (assembled?.status !== "ok") return;
    const contents = await readFile(join(cwd, assembled.path), "utf8");
    expect(contents).toContain(`# tskl) rule = no-simply\n${source}`);
  });

  // What the schema notes without refusing rides on the result, so `check` can
  // say it without the exit code hearing it.
  it("carries the schema's advisories", async () => {
    await valeRule(
      "no-simply",
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n\n[.taskless/**]\ntskl) rule = no-simply\nno-simply.no-simply = NO\n"
    );
    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("ok");
    if (assembled?.status !== "ok") return;
    expect(assembled.advisories).toHaveLength(1);
    expect(assembled.advisories[0]).toContain("[.taskless/**]");
    expect(assembled.advisories[0]).toContain("unnecessary");
  });

  // Writing an empty config would have Vale lint the project against no rules
  // and report a clean pass, which is indistinguishable from a passing check.
  it("writes nothing when no rule declares a config", async () => {
    expect(await assembleValeConfig(cwd)).toBeUndefined();
  });

  // `sections` has to carry every section this config will actually have
  // Vale evaluate — a re-parse of the written file, which this is not, would
  // be a second, weaker source of the same fact.
  it("returns every section pattern it wrote, deduplicated and sorted", async () => {
    await valeRule(
      "no-simply",
      "[*.md]\ntskl) rule = no-simply\nno-simply.no-simply = YES\n"
    );
    await valeRule(
      "no-very",
      "[*.md]\ntskl) rule = no-very\nno-very.no-very = YES\n\n[**/README.md]\ntskl) rule = no-very\nno-very.no-very = YES\n"
    );

    const assembled = await assembleValeConfig(cwd);
    expect(assembled?.status).toBe("ok");
    if (assembled?.status !== "ok") return;
    expect(assembled.sections).toEqual(["**/README.md", "*.md"]);
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
