import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCommandStub,
  buildSkillStub,
  isShimStub,
  stubFrontmatterDrifted,
  stubPredatesRecovery,
  stubRecoveryInvocation,
  stubRecoveryInvocationStale,
  writeCanonicalCommand,
  writeCanonicalSkill,
} from "../src/install/canonical";
import { parseFrontmatter } from "../src/install/frontmatter";
import {
  buildInvocation,
  isProductionInvocation,
} from "../src/util/invocation";

const SENTINEL = "INLINED-CANONICAL-BODY-MARKER";

const skillSource = `---
name: taskless
description: Use for any Taskless task.
---

# Taskless

${SENTINEL} — full canonical skill instructions live here.
`;

describe("writeCanonicalSkill / writeCanonicalCommand", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-canonical-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("writes skill content to .taskless/skills verbatim", async () => {
    const path = await writeCanonicalSkill(
      temporaryDirectory,
      "taskless",
      skillSource
    );
    expect(path).toBe(
      join(temporaryDirectory, ".taskless", "skills", "taskless", "SKILL.md")
    );
    expect(await readFile(path, "utf8")).toBe(skillSource);
  });

  it("writes command content to .taskless/commands/tskl verbatim", async () => {
    const commandSource = "---\nname: Taskless\n---\n\nbody\n";
    const path = await writeCanonicalCommand(
      temporaryDirectory,
      "tskl.md",
      commandSource
    );
    expect(path).toBe(
      join(temporaryDirectory, ".taskless", "commands", "tskl", "tskl.md")
    );
    expect(await readFile(path, "utf8")).toBe(commandSource);
  });
});

describe("buildSkillStub", () => {
  it("produces valid frontmatter, a delegating body, and no inlined content", () => {
    const stub = buildSkillStub({
      name: "taskless",
      description: "Use for any Taskless task.",
    });

    const { data, content } = parseFrontmatter(stub);
    expect(data.name).toBe("taskless");
    expect(data.description).toBe("Use for any Taskless task.");
    expect((data.metadata as { type?: string }).type).toBe("shim");

    expect(content).toContain(".taskless/skills/taskless/SKILL.md");
    expect(content.toLowerCase()).toContain("read");
    expect(stub).not.toContain(SENTINEL);
  });

  it("tells the reader how to restore a canonical file that is missing", () => {
    const stub = buildSkillStub({ name: "taskless", description: "d" });
    const { content } = parseFrontmatter(stub);
    expect(content).toContain("does not exist");
    // The invocation is the build's own, so a dev/self build points at its own
    // binary rather than sending the reader to the published package.
    expect(content).toContain(`\`${buildInvocation()} init\``);
  });

  it("embeds nothing that varies per release", () => {
    const stub = buildSkillStub({ name: "taskless", description: "d" });
    // The stub lives outside `.taskless`, so its bytes must not move when only
    // the CLI version does. A prod build's invocation carries no version.
    expect(isProductionInvocation()).toBe(true);
    expect(stub).not.toContain(__VERSION__);
  });

  it("carries metadata.type shim and records no version", () => {
    const stub = buildSkillStub({ name: "taskless", description: "d" });
    const metadata = parseFrontmatter(stub).data.metadata as {
      type?: string;
      version?: string;
    };
    expect(metadata.type).toBe("shim");
    expect(metadata.version).toBeUndefined();
  });

  it("writes to disk as a regular file, not a symlink", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-stub-"));
    try {
      const stubPath = join(temporaryDirectory, "SKILL.md");
      await writeFile(
        stubPath,
        buildSkillStub({ name: "taskless", description: "desc" }),
        "utf8"
      );
      const stats = await lstat(stubPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe("buildCommandStub", () => {
  it("passes $ARGUMENTS through and delegates to the canonical command", () => {
    const stub = buildCommandStub(
      { name: "Taskless", description: "Run any Taskless action." },
      "tskl.md"
    );
    const { data, content } = parseFrontmatter(stub);
    expect(data.name).toBe("Taskless");
    expect(content).toContain("$ARGUMENTS");
    expect(content).toContain(".taskless/commands/tskl/tskl.md");
  });

  it("carries the same recovery instruction as a skill stub", () => {
    const stub = buildCommandStub(
      { name: "Taskless", description: "Run any Taskless action." },
      "tskl.md"
    );
    const { content } = parseFrontmatter(stub);
    expect(content).toContain("does not exist");
    expect(content).toContain(`\`${buildInvocation()} init\``);
  });

  it("preserves the canonical argument-hint when present", () => {
    const stub = buildCommandStub(
      {
        name: "Taskless",
        description: "Run any Taskless action.",
        argumentHint: "<describe what you want to do>",
      },
      "tskl.md"
    );
    const { data } = parseFrontmatter(stub);
    expect(data["argument-hint"]).toBe("<describe what you want to do>");
  });

  it("omits argument-hint when the canonical command has none", () => {
    const stub = buildCommandStub(
      { name: "Taskless", description: "Run any Taskless action." },
      "tskl.md"
    );
    const { data } = parseFrontmatter(stub);
    expect(data["argument-hint"]).toBeUndefined();
  });
});

describe("isShimStub", () => {
  it("returns true for a generated skill stub", () => {
    expect(
      isShimStub(buildSkillStub({ name: "taskless", description: "d" }))
    ).toBe(true);
  });

  it("returns true for a generated command stub", () => {
    expect(
      isShimStub(
        buildCommandStub({ name: "Taskless", description: "d" }, "tskl.md")
      )
    ).toBe(true);
  });

  it("returns false for a full canonical skill copy", () => {
    // skillSource has no metadata.type — it is a full copy, not a stub.
    expect(isShimStub(skillSource)).toBe(false);
  });

  it("returns false for content without frontmatter", () => {
    expect(isShimStub("# just a heading\n")).toBe(false);
  });
});

describe("stubFrontmatterDrifted", () => {
  const meta = { name: "taskless", description: "Use for any Taskless task." };

  it("returns false for a stub that still matches the canonical", () => {
    const stub = buildSkillStub(meta);
    expect(stubFrontmatterDrifted(stub, meta)).toBe(false);
  });

  it("returns true when the description has drifted", () => {
    const stub = buildSkillStub(meta);
    expect(
      stubFrontmatterDrifted(stub, { ...meta, description: "changed" })
    ).toBe(true);
  });

  it("returns true when the name has drifted", () => {
    const stub = buildSkillStub(meta);
    expect(stubFrontmatterDrifted(stub, { ...meta, name: "renamed" })).toBe(
      true
    );
  });

  it("treats a lingering metadata.version as drift (one-time migration)", () => {
    const legacyStub = [
      "---",
      "name: taskless",
      "description: Use for any Taskless task.",
      "metadata:",
      "  type: shim",
      "  version: 0.7.0",
      "---",
      "",
      "body",
      "",
    ].join("\n");
    expect(stubFrontmatterDrifted(legacyStub, meta)).toBe(true);
  });
});

describe("stubPredatesRecovery", () => {
  it("returns false for a stub generated now", () => {
    expect(
      stubPredatesRecovery(
        buildSkillStub({ name: "taskless", description: "d" })
      )
    ).toBe(false);
    expect(
      stubPredatesRecovery(
        buildCommandStub({ name: "Taskless", description: "d" }, "tskl.md")
      )
    ).toBe(false);
  });

  it("returns true for a stub written before the recovery instruction", () => {
    const legacyStub = [
      "---",
      "name: taskless",
      "description: d",
      "metadata:",
      "  type: shim",
      "---",
      "",
      "This is a Taskless reference stub. The canonical skill is defined at",
      "`.taskless/skills/taskless/SKILL.md`.",
      "",
      "Read `.taskless/skills/taskless/SKILL.md` and follow its instructions.",
      "",
    ].join("\n");
    expect(stubPredatesRecovery(legacyStub)).toBe(true);
  });
});

/** A copy of `stub` whose recovery line names `invocation` instead. */
function withRecoveryInvocation(stub: string, invocation: string): string {
  const current = stubRecoveryInvocation(stub);
  if (current === undefined) throw new Error("stub carries no recovery line");
  return stub.replace(`run \`${current}\``, `run \`${invocation}\``);
}

describe("stubRecoveryInvocation / stubRecoveryInvocationStale", () => {
  const meta = { name: "taskless", description: "Use for any Taskless task." };
  // This project runs under a released define, so a stub written here carries
  // the released invocation. The nightly side of the same behaviour lives in
  // test/nightly/stub-recovery-invocation.test.ts.
  const productionRestore = `${buildInvocation()} init`;

  it("reads the invocation back out of a stub it wrote", () => {
    expect(stubRecoveryInvocation(buildSkillStub(meta))).toBe(
      productionRestore
    );
    expect(stubRecoveryInvocation(buildCommandStub(meta, "tskl.md"))).toBe(
      productionRestore
    );
  });

  it("returns undefined for a stub that predates the recovery instruction", () => {
    expect(
      stubRecoveryInvocation("---\nname: t\n---\n\nbody\n")
    ).toBeUndefined();
  });

  it("leaves a stub written by this same build alone", () => {
    expect(stubRecoveryInvocationStale(buildSkillStub(meta))).toBe(false);
    expect(stubRecoveryInvocationStale(buildCommandStub(meta, "tskl.md"))).toBe(
      false
    );
  });

  it("reclaims a stub frozen with a pinned nightly invocation", () => {
    // taskless/cli#227: try a nightly once, go back to the released CLI, and
    // every later install reported "up to date" while the recovery line kept
    // naming a nightly version that may no longer be published.
    const frozen = withRecoveryInvocation(
      buildSkillStub(meta),
      "npx @taskless/cli-nightly@0.11.0-nightly.20260101 init"
    );
    expect(stubRecoveryInvocationStale(frozen)).toBe(true);
  });

  it("reclaims a stub frozen with a self build's filesystem path", () => {
    const frozen = withRecoveryInvocation(
      buildSkillStub(meta),
      "node packages/cli/dist-self/index.js init"
    );
    expect(stubRecoveryInvocationStale(frozen)).toBe(true);
  });

  it("says nothing about a stub that has no recovery line at all", () => {
    // That case belongs to stubPredatesRecovery, which rewrites it anyway.
    expect(stubRecoveryInvocationStale("---\nname: t\n---\n\nbody\n")).toBe(
      false
    );
  });
});
