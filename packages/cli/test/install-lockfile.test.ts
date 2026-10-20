import { describe, expect, it } from "vitest";

import type { PnpmLockfile } from "../scripts/install-lockfile";
import { buildInstallLockfile } from "../scripts/install-lockfile";

/** A small `pnpm-lock.yaml` shaped like the CLI's: one runtime dep, platform optionals. */
function fixture(): PnpmLockfile {
  return {
    importers: {
      "packages/cli": {
        dependencies: { tsx: { version: "4.21.0" } },
        optionalDependencies: {
          "@ast-grep/cli-linux-x64-gnu": { version: "0.45.3" },
        },
      },
    },
    packages: {
      "tsx@4.21.0": {
        resolution: { integrity: "sha512-tsx" },
        engines: { node: ">=18.0.0" },
      },
      "esbuild@0.27.3": { resolution: { integrity: "sha512-esbuild" } },
      "@esbuild/linux-x64@0.27.3": {
        resolution: { integrity: "sha512-esbuild-linux" },
        os: ["linux"],
        cpu: ["x64"],
      },
      "@ast-grep/cli-linux-x64-gnu@0.45.3": {
        resolution: { integrity: "sha512-sg-linux" },
        os: ["linux"],
        cpu: ["x64"],
      },
    },
    snapshots: {
      "tsx@4.21.0": { dependencies: { esbuild: "0.27.3" } },
      "esbuild@0.27.3": {
        optionalDependencies: { "@esbuild/linux-x64": "0.27.3" },
      },
      "@esbuild/linux-x64@0.27.3": {},
      "@ast-grep/cli-linux-x64-gnu@0.45.3": {},
    },
  };
}

const CLI = {
  name: "@taskless/cli",
  version: "0.13.1",
  license: "MIT",
  bin: { taskless: "./dist/index.js" },
  dependencies: { tsx: "^4.21.0" },
  optionalDependencies: { "@ast-grep/cli-linux-x64-gnu": "0.45.3" },
};

describe("buildInstallLockfile", () => {
  it("roots the lockfile at the exact CLI version, with no integrity for the CLI itself", () => {
    const lock = buildInstallLockfile(fixture(), "packages/cli", CLI);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[""]).toEqual({
      dependencies: { "@taskless/cli": "0.13.1" },
    });
    const cli = lock.packages["node_modules/@taskless/cli"];
    expect(cli?.version).toBe("0.13.1");
    expect(cli?.resolved).toBe(
      "https://registry.npmjs.org/@taskless/cli/-/cli-0.13.1.tgz"
    );
    expect(cli?.integrity).toBeUndefined();
    // The package's own ranges, as published; the pins live in its dependencies' entries.
    expect(cli?.dependencies).toEqual({ tsx: "^4.21.0" });
  });

  it("pins every dependency to pnpm's version and integrity, flat", () => {
    const lock = buildInstallLockfile(fixture(), "packages/cli", CLI);
    expect(lock.packages["node_modules/tsx"]).toEqual({
      version: "4.21.0",
      resolved: "https://registry.npmjs.org/tsx/-/tsx-4.21.0.tgz",
      integrity: "sha512-tsx",
      engines: { node: ">=18.0.0" },
      dependencies: { esbuild: "0.27.3" },
    });
    expect(lock.packages["node_modules/esbuild"]?.optionalDependencies).toEqual(
      { "@esbuild/linux-x64": "0.27.3" }
    );
  });

  it("keeps platform constraints and marks packages reached only through optional edges", () => {
    const lock = buildInstallLockfile(fixture(), "packages/cli", CLI);
    expect(lock.packages["node_modules/@esbuild/linux-x64"]).toMatchObject({
      os: ["linux"],
      cpu: ["x64"],
      optional: true,
    });
    expect(
      lock.packages["node_modules/@ast-grep/cli-linux-x64-gnu"]
    ).toMatchObject({
      optional: true,
    });
    expect(lock.packages["node_modules/esbuild"]?.optional).toBeUndefined();
  });

  it("names the nightly's tarball under its own package", () => {
    const lock = buildInstallLockfile(fixture(), "packages/cli", {
      ...CLI,
      name: "@taskless/cli-nightly",
      version: "0.14.0-20261020120000xabc1234",
    });
    expect(lock.packages["node_modules/@taskless/cli-nightly"]?.resolved).toBe(
      "https://registry.npmjs.org/@taskless/cli-nightly/-/cli-nightly-0.14.0-20261020120000xabc1234.tgz"
    );
  });

  it("fails, naming the package, when one name resolves to two versions", () => {
    const lock = fixture();
    lock.packages["esbuild@0.28.0"] = {
      resolution: { integrity: "sha512-other" },
    };
    lock.snapshots["esbuild@0.28.0"] = {};
    lock.importers["packages/cli"]!.dependencies!.esbuild = {
      version: "0.28.0",
    };
    expect(() => buildInstallLockfile(lock, "packages/cli", CLI)).toThrow(
      /esbuild resolves to both/
    );
  });

  it("fails, naming the package, when a package has no integrity", () => {
    const lock = fixture();
    delete lock.packages["esbuild@0.27.3"]!.resolution;
    expect(() => buildInstallLockfile(lock, "packages/cli", CLI)).toThrow(
      /esbuild@0\.27\.3 has no integrity/
    );
  });

  it("drops pnpm's peer suffix from versions", () => {
    const lock = fixture();
    lock.snapshots["tsx@4.21.0"] = {
      dependencies: { esbuild: "0.27.3(typescript@5.9.3)" },
    };
    lock.snapshots["esbuild@0.27.3(typescript@5.9.3)"] =
      lock.snapshots["esbuild@0.27.3"]!;
    const result = buildInstallLockfile(lock, "packages/cli", CLI);
    expect(result.packages["node_modules/esbuild"]?.version).toBe("0.27.3");
    expect(result.packages["node_modules/tsx"]?.dependencies).toEqual({
      esbuild: "0.27.3",
    });
  });
});
