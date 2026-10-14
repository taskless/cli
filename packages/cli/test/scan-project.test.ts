import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureTasklessDirectory } from "../src/filesystem/directory";
import { scanProject } from "../src/rules/scan-project";
import { findValeBinary } from "../src/rules/vale/binary";

/**
 * `report` runs this scan to measure what the rules find, and a report's draft
 * must stay offline. Anonymous is what keeps it there: no reconcile, so no
 * request, and every runtime rule skipped rather than run unverified.
 */

const fixturesDirectory = resolve(
  import.meta.dirname,
  "fixtures/mixed-engines-project"
);

const RUNTIME_CAPTURE = [
  "id: logs",
  "language: TypeScript",
  "rule:",
  "  pattern: console.log($$$)",
  "metadata:",
  "  taskless:",
  "    version: 1",
  "    kind: runtime",
  "    name: logs",
  "    check: check.ts",
  "    match: anchor",
  "",
].join("\n");

const RUNTIME_CHECK = `export default async function (root, matches) {
  return matches.map((m) => ({ file: m.file, line: m.line, message: "runtime", severity: "warning" }));
}
`;

/** Vale ships per-platform; an unsupported host has none. */
const withVale = findValeBinary().path === undefined ? describe.skip : describe;

withVale("scanProject, anonymous", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "taskless-scan-"));
    await cp(fixturesDirectory, project, { recursive: true });
    const runtime = join(project, ".taskless", "rules", "runtime", "demo");
    await mkdir(join(runtime, "captures"), { recursive: true });
    await writeFile(join(runtime, "captures", "logs.yml"), RUNTIME_CAPTURE);
    await writeFile(join(runtime, "check.ts"), RUNTIME_CHECK);
    await ensureTasklessDirectory(project, { onNotice: () => {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("the anonymous scan made a network request");
      })
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(project, { recursive: true, force: true });
  });

  it("runs sg and vale, skips runtime, and makes no request", async () => {
    const { plan, dispatched } = await scanProject(project, {
      paths: [],
      anonymous: true,
      dangerouslyRunScripts: false,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(plan.execute).toEqual([]);
    expect(plan.skipped.map((skipped) => skipped.rule)).toContain("demo");
    const sources = new Set(dispatched.results.map((result) => result.source));
    expect(sources).toEqual(new Set(["ast-grep", "vale"]));
  });
});
