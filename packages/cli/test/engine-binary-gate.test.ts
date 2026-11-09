import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AST_GREP_BINARY } from "../src/rules/ast-grep-binary";
import { AST_GREP_VERSION } from "../src/rules/capabilities";
import {
  binaryMismatchMessage,
  findBinaryMismatches,
  requireReconciledEngines,
} from "../src/rules/engine-gate";
import {
  resolvePlatformBinary,
  type PlatformBinaryResolution,
} from "../src/rules/platform-binary";
import * as scan from "../src/rules/scan";

/**
 * #650: with the pinned platform package missing, `check` fell back to an `sg`
 * or `vale` from `node_modules/.bin` or PATH and ran it whatever its version.
 * The gate now asks the fallback binary for its version, using the output the
 * identity check already read, and refuses a mismatch.
 */

const BUNDLED = { sg: "0.51.0", vale: "3.26.0" };
const onUnix = process.platform === "win32" ? it.skip : it;

const workspaces: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A directory holding an `sg` that identifies as ast-grep `version`. */
function fakeSgOnPath(version: string): string {
  const directory = mkdtempSync(join(tmpdir(), "taskless-sg-path-"));
  workspaces.push(directory);
  const binary = join(directory, "sg");
  writeFileSync(binary, `#!/bin/sh\necho 'ast-grep ${version}'\n`);
  chmodSync(binary, 0o755);
  return directory;
}

/** Resolve ast-grep with the platform package out of reach, so PATH answers. */
function resolveFromPath(directory: string): PlatformBinaryResolution {
  const original = process.env.PATH;
  process.env.PATH = directory;
  try {
    return resolvePlatformBinary({
      ...AST_GREP_BINARY,
      packagePrefix: "@taskless/does-not-exist",
    });
  } finally {
    process.env.PATH = original;
  }
}

describe("a fallback engine binary is held to the bundled version", () => {
  onUnix(
    "refuses a PATH binary of another version, naming its path and version",
    () => {
      const directory = fakeSgOnPath("0.39.0");
      const resolution = resolveFromPath(directory);
      expect(resolution.source).toBe("PATH");

      const mismatches = findBinaryMismatches({ sg: resolution }, BUNDLED);
      expect(mismatches).toEqual([
        {
          engine: "sg",
          path: join(directory, "sg"),
          source: "PATH",
          reported: "0.39.0",
          bundled: "0.51.0",
        },
      ]);
      const message = binaryMismatchMessage(mismatches);
      expect(message).toContain(
        `ast-grep at ${join(directory, "sg")} (found in PATH) reports 0.39.0, and this CLI bundles 0.51.0`
      );
      expect(message).toContain("--allow-version-mismatches");
    }
  );

  onUnix("passes a PATH binary of the bundled version", () => {
    const resolution = resolveFromPath(fakeSgOnPath("0.51.0"));
    expect(findBinaryMismatches({ sg: resolution }, BUNDLED)).toEqual([]);
  });

  it("does not compare the pinned platform package", () => {
    // Its version is the bundled one by construction, and is not re-read.
    const pinned: PlatformBinaryResolution = {
      path: "/pinned/ast-grep",
      source: "platform-package",
      versionOutput: "ast-grep 0.1.0",
      tried: [],
    };
    expect(findBinaryMismatches({ sg: pinned }, BUNDLED)).toEqual([]);
    // The real resolution on this host is the platform package.
    const real = resolvePlatformBinary(AST_GREP_BINARY);
    if (real.path !== undefined) {
      expect(findBinaryMismatches({ sg: real })).toEqual([]);
    }
  });

  it("refuses a fallback binary whose version cannot be read", () => {
    const [mismatch] = findBinaryMismatches(
      {
        vale: {
          path: "/usr/local/bin/vale",
          source: "node_modules/.bin",
          versionOutput: "vale (devel)",
          tried: [],
        },
      },
      BUNDLED
    );
    expect(mismatch?.reported).toBeUndefined();
    expect(binaryMismatchMessage(mismatch ? [mismatch] : [])).toContain(
      "Vale at /usr/local/bin/vale (found in node_modules/.bin) reports no version this CLI can read"
    );
  });

  it("leaves an engine with nothing resolved to its own not-found handling", () => {
    expect(
      findBinaryMismatches(
        { sg: { path: undefined, source: undefined, tried: ["PATH"] } },
        BUNDLED
      )
    ).toEqual([]);
  });
});

/** A project with one ast-grep rule, so the sg binary is gated. */
function projectWithSgRule(): string {
  const directory = mkdtempSync(join(tmpdir(), "taskless-binary-gate-"));
  workspaces.push(directory);
  mkdirSync(join(directory, ".taskless", "rules", "sg", "no-eval"), {
    recursive: true,
  });
  return directory;
}

describe("check's engine gate refuses the binary", () => {
  const stale: PlatformBinaryResolution = {
    path: "/opt/bin/sg",
    source: "PATH",
    versionOutput: "ast-grep 0.39.0",
    tried: [],
  };

  it("throws ENGINE_BINARY_MISMATCH for a stale PATH ast-grep", async () => {
    vi.spyOn(scan, "resolveSgBinary").mockReturnValue(stale);
    await expect(
      requireReconciledEngines(projectWithSgRule())
    ).rejects.toMatchObject({
      code: "ENGINE_BINARY_MISMATCH",
      message: expect.stringContaining("/opt/bin/sg") as unknown,
    });
  });

  it("lets --allow-version-mismatches run it anyway", async () => {
    vi.spyOn(scan, "resolveSgBinary").mockReturnValue(stale);
    const argv = process.argv;
    process.argv = [...argv, "--allow-version-mismatches"];
    try {
      await expect(
        requireReconciledEngines(projectWithSgRule())
      ).resolves.toBeUndefined();
    } finally {
      process.argv = argv;
    }
  });

  it("is unchanged for the bundled version", async () => {
    vi.spyOn(scan, "resolveSgBinary").mockReturnValue({
      ...stale,
      versionOutput: `ast-grep ${AST_GREP_VERSION}`,
    });
    await expect(
      requireReconciledEngines(projectWithSgRule())
    ).resolves.toBeUndefined();
  });
});
