import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSkillStub,
  isShimStub,
  stubFrontmatterDrifted,
  stubPredatesRecovery,
  stubRecoveryInvocation,
  stubRecoveryInvocationStale,
  writeCanonicalSkill,
} from "../src/install/canonical";
import { parseFrontmatter } from "../src/install/frontmatter";
import {
  isProductionInvocation,
  PROD_INVOCATION,
} from "../src/util/invocation";

const SENTINEL = "INLINED-CANONICAL-BODY-MARKER";

const skillSource = `---
name: taskless
description: Use for any Taskless task.
---

# Taskless

${SENTINEL} — full canonical skill instructions live here.
`;

describe("writeCanonicalSkill", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-canonical-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("writes skill content to .taskless/skills verbatim", async () => {
    const { path, changed } = await writeCanonicalSkill(
      temporaryDirectory,
      "taskless",
      skillSource
    );
    expect(changed).toBe(true);
    expect(path).toBe(
      join(temporaryDirectory, ".taskless", "skills", "taskless", "SKILL.md")
    );
    expect(await readFile(path, "utf8")).toBe(skillSource);
  });

  it("reports no change when the bytes on disk already match", async () => {
    // Every install used to rewrite the store, so every run looked like an
    // upgrade to whoever read the summary. Identical bytes are not a write.
    await writeCanonicalSkill(temporaryDirectory, "taskless", skillSource);
    const second = await writeCanonicalSkill(
      temporaryDirectory,
      "taskless",
      skillSource
    );
    expect(second.changed).toBe(false);

    const third = await writeCanonicalSkill(
      temporaryDirectory,
      "taskless",
      `${skillSource}\nmore\n`
    );
    expect(third.changed).toBe(true);
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
    // A release keeps the unpinned form here, so the stub does not change on
    // every release; a self or nightly build names its own invocation (see
    // test/nightly/stub-recovery-invocation.test.ts).
    expect(content).toContain(`\`${PROD_INVOCATION} init\``);
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

describe("isShimStub", () => {
  it("returns true for a generated skill stub", () => {
    expect(
      isShimStub(buildSkillStub({ name: "taskless", description: "d" }))
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
  // the released restore command, which stays unpinned. The nightly side of
  // the same behaviour lives in test/nightly/stub-recovery-invocation.test.ts.
  const productionRestore = `${PROD_INVOCATION} init`;

  it("reads the invocation back out of a stub it wrote", () => {
    expect(stubRecoveryInvocation(buildSkillStub(meta))).toBe(
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
