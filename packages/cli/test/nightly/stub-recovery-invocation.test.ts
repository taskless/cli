import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCommandStub,
  buildSkillStub,
  stubRecoveryInvocation,
  stubRecoveryInvocationStale,
} from "../../src/install/canonical";
import {
  applyInstallPlan,
  buildInstallPlan,
  getEmbeddedCommands,
  getEmbeddedSkills,
} from "../../src/install/install";
import {
  buildInvocation,
  isProductionInvocation,
  PROD_INVOCATION,
} from "../../src/util/invocation";

/**
 * Everything in this file runs under the `nightly` vitest project, whose
 * `__TASKLESS_CLI__` define is a pinned `@taskless/cli-nightly@<version>` (see
 * the `projects` block in vite.config.ts).
 *
 * That is the whole reason the file exists. The rest of the suite runs under a
 * prod define, where the recovery invocation carries no version and the
 * divergence taskless/cli#227 describes cannot be expressed, let alone
 * asserted on.
 */
const PROD_RESTORE = `${PROD_INVOCATION} init`;
const NIGHTLY_RESTORE = `${buildInvocation()} init`;
const OTHER_NIGHTLY_RESTORE =
  "npx @taskless/cli-nightly@0.0.0-nightly.other init";

const META = { name: "taskless", description: "Use for any Taskless task." };

function withRecoveryInvocation(stub: string, invocation: string): string {
  const current = stubRecoveryInvocation(stub);
  if (current === undefined) throw new Error("stub carries no recovery line");
  return stub.replace(`run \`${current}\``, `run \`${invocation}\``);
}

describe("the nightly build's own stubs", () => {
  it("runs under a nightly define, not the released one", () => {
    expect(isProductionInvocation()).toBe(false);
    expect(buildInvocation()).toContain("@taskless/cli-nightly@");
  });

  it("names its own pinned package in the recovery line", () => {
    expect(stubRecoveryInvocation(buildSkillStub(META))).toBe(NIGHTLY_RESTORE);
    expect(stubRecoveryInvocation(buildCommandStub(META, "tskl.md"))).toBe(
      NIGHTLY_RESTORE
    );
  });

  it("does not consider a stub it just wrote stale", () => {
    expect(stubRecoveryInvocationStale(buildSkillStub(META))).toBe(false);
    expect(stubRecoveryInvocationStale(buildCommandStub(META, "tskl.md"))).toBe(
      false
    );
  });
});

describe("stubRecoveryInvocationStale under a nightly build", () => {
  const nightlyStub = buildSkillStub(META);

  it("leaves a released build's stub alone (no cross-build ping-pong)", () => {
    const productionStub = withRecoveryInvocation(nightlyStub, PROD_RESTORE);
    expect(stubRecoveryInvocationStale(productionStub)).toBe(false);
  });

  it("reclaims a different nightly's pin, which names a build that is not here", () => {
    const stale = withRecoveryInvocation(nightlyStub, OTHER_NIGHTLY_RESTORE);
    expect(stubRecoveryInvocationStale(stale)).toBe(true);
  });

  it("reclaims a self build's filesystem path", () => {
    const stale = withRecoveryInvocation(
      nightlyStub,
      "node packages/cli/dist-self/index.js init"
    );
    expect(stubRecoveryInvocationStale(stale)).toBe(true);
  });
});

describe("installing a nightly over an existing stub", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "taskless-nightly-stub-"));
    await mkdir(join(cwd, ".taskless"), { recursive: true });
    await writeFile(
      join(cwd, ".taskless", "taskless.json"),
      JSON.stringify({ version: 2, install: {} }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const stubPath = () => join(cwd, ".claude", "skills", "taskless", "SKILL.md");

  async function install(): Promise<void> {
    const skills = getEmbeddedSkills().filter((s) => s.name === "taskless");
    const plan = buildInstallPlan([".claude"], skills, getEmbeddedCommands());
    await applyInstallPlan(cwd, plan, { cliVersion: "0.0.0-nightly.test" });
  }

  it("leaves a released build's recovery line in place", async () => {
    await install();
    const written = await readFile(stubPath(), "utf8");
    await writeFile(
      stubPath(),
      withRecoveryInvocation(written, PROD_RESTORE),
      "utf8"
    );

    await install();

    // The released invocation resolves for everyone, so a nightly has no reason
    // to overwrite it — this is the assertion that the fix for #227 did not
    // reintroduce a rewrite-on-every-install loop between the two builds.
    expect(stubRecoveryInvocation(await readFile(stubPath(), "utf8"))).toBe(
      PROD_RESTORE
    );
  });

  it("reclaims another nightly's pinned recovery line", async () => {
    await install();
    const written = await readFile(stubPath(), "utf8");
    await writeFile(
      stubPath(),
      withRecoveryInvocation(written, OTHER_NIGHTLY_RESTORE),
      "utf8"
    );

    await install();

    expect(stubRecoveryInvocation(await readFile(stubPath(), "utf8"))).toBe(
      NIGHTLY_RESTORE
    );
  });

  it("is idempotent: a second nightly install rewrites nothing", async () => {
    await install();
    const first = await readFile(stubPath(), "utf8");
    await install();
    expect(await readFile(stubPath(), "utf8")).toBe(first);
    expect(dirname(stubPath())).toContain(".claude");
  });
});
