/**
 * The npm lockfile a published build carries for its project launcher.
 *
 * The launcher installs its package with `npm ci` from this file, so what a
 * project runs is the dependency tree this repository tested, not whatever the
 * `package.json` ranges resolve to on the day of the install. It is derived
 * from `pnpm-lock.yaml`, which is what CI installs, without the network and
 * without touching `package.json`: development keeps its ranges, a release is
 * frozen.
 *
 * NOT AN `npm-shrinkwrap.json`. npm reads a dependency's shrinkwrap after its
 * platform check, so a full one installs every platform's ast-grep, Vale and
 * esbuild binaries (measured: 1.0 GB instead of 110 MB), and one without the
 * platform packages installs none. A lockfile at the root of an `npm ci`
 * install is filtered by platform as usual.
 *
 * Pure over its inputs, like `build-target.ts`, so it is unit-testable over a
 * fixture lockfile.
 */

/** The parts of a parsed `pnpm-lock.yaml` (v9) this reads. */
export interface PnpmLockfile {
  importers: Record<
    string,
    {
      dependencies?: Record<string, { version: string }>;
      optionalDependencies?: Record<string, { version: string }>;
    }
  >;
  packages: Record<
    string,
    {
      resolution?: { integrity?: string };
      engines?: Record<string, string>;
      os?: string[];
      cpu?: string[];
      libc?: string[];
    }
  >;
  snapshots: Record<
    string,
    {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }
  >;
}

/** The CLI package being locked: its own manifest fields, under its published name. */
export interface LockedPackage {
  name: string;
  version: string;
  license?: string;
  bin?: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** One `packages` entry of an npm v3 lockfile. */
export interface NpmLockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  optional?: true;
  bin?: Record<string, string>;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface NpmLockfile {
  name: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, NpmLockEntry>;
}

/** The root `package.json` the launcher writes beside this lockfile. */
export const INSTALL_ROOT_NAME = "taskless-launcher";

const REGISTRY = "https://registry.npmjs.org";

/** npm's tarball URL for a package version on the public registry. */
function tarballUrl(name: string, version: string): string {
  const base = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${REGISTRY}/${name}/-/${base}-${version}.tgz`;
}

/** A snapshot reference's version, without pnpm's peer suffix `(...)`. */
function bareVersion(reference: string): string {
  const index = reference.indexOf("(");
  return index === -1 ? reference : reference.slice(0, index);
}

/** A snapshot's dependency map with every reference reduced to its version. */
function pin(
  references: Record<string, string> | undefined
): Record<string, string> | undefined {
  return references === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(references).map(([child, reference]) => [
          child,
          bareVersion(reference),
        ])
      );
}

/**
 * Build the lockfile for `locked`, whose dependencies are the ones the
 * `importer` (e.g. `packages/cli`) resolved in `lock`.
 *
 * Throws, naming the package, when the tree cannot be written as one flat
 * `node_modules`: a name at two versions, or a package without an integrity.
 * A build must fail then rather than ship a partial lockfile.
 */
export function buildInstallLockfile(
  lock: PnpmLockfile,
  importer: string,
  locked: LockedPackage
): NpmLockfile {
  const root = lock.importers[importer];
  if (root === undefined) {
    throw new Error(`pnpm-lock.yaml has no importer ${importer}`);
  }

  // name -> version, and whether every path to it runs through an optional edge.
  const versions = new Map<string, string>();
  const required = new Set<string>();
  const snapshotKeys = new Map<string, string>();

  const visit = (name: string, reference: string, optional: boolean) => {
    const version = bareVersion(reference);
    const seen = versions.get(name);
    if (seen !== undefined && seen !== version) {
      throw new Error(
        `${name} resolves to both ${seen} and ${version} in the ${locked.name} tree; ` +
          `the install lockfile is flat and cannot hold two versions`
      );
    }
    const firstRequired = !optional && !required.has(name);
    if (seen !== undefined && !firstRequired) return;
    versions.set(name, version);
    snapshotKeys.set(name, `${name}@${reference}`);
    if (!optional) required.add(name);
    const snapshot = lock.snapshots[`${name}@${reference}`] ?? {};
    for (const [child, childReference] of Object.entries(
      snapshot.dependencies ?? {}
    )) {
      visit(child, childReference, optional);
    }
    for (const [child, childReference] of Object.entries(
      snapshot.optionalDependencies ?? {}
    )) {
      visit(child, childReference, true);
    }
  };

  for (const [name, { version }] of Object.entries(root.dependencies ?? {})) {
    visit(name, version, false);
  }
  for (const [name, { version }] of Object.entries(
    root.optionalDependencies ?? {}
  )) {
    visit(name, version, true);
  }

  const packages: Record<string, NpmLockEntry> = {
    "": {
      dependencies: { [locked.name]: locked.version },
    },
    // No integrity: this lockfile ships inside this package's tarball, so it
    // cannot hold that tarball's hash. The exact version pins it instead; a
    // published npm version cannot be republished with other contents.
    [`node_modules/${locked.name}`]: {
      version: locked.version,
      resolved: tarballUrl(locked.name, locked.version),
      ...(locked.license === undefined ? {} : { license: locked.license }),
      ...(locked.dependencies === undefined
        ? {}
        : { dependencies: locked.dependencies }),
      ...(locked.optionalDependencies === undefined
        ? {}
        : { optionalDependencies: locked.optionalDependencies }),
      ...(locked.bin === undefined ? {} : { bin: locked.bin }),
      ...(locked.engines === undefined ? {} : { engines: locked.engines }),
    },
  };

  for (const name of [...versions.keys()].toSorted()) {
    const version = versions.get(name) ?? "";
    const key = `${name}@${version}`;
    const metadata = lock.packages[key];
    const integrity = metadata?.resolution?.integrity;
    if (integrity === undefined) {
      throw new Error(
        `${key} has no integrity in pnpm-lock.yaml; the install lockfile pins every package by hash`
      );
    }
    const snapshot = lock.snapshots[snapshotKeys.get(name) ?? key] ?? {};
    const dependencies = pin(snapshot.dependencies);
    const optionalDependencies = pin(snapshot.optionalDependencies);
    packages[`node_modules/${name}`] = {
      version,
      resolved: tarballUrl(name, version),
      integrity,
      ...(required.has(name) ? {} : { optional: true }),
      ...(metadata?.engines === undefined ? {} : { engines: metadata.engines }),
      ...(metadata?.os === undefined ? {} : { os: metadata.os }),
      ...(metadata?.cpu === undefined ? {} : { cpu: metadata.cpu }),
      ...(metadata?.libc === undefined ? {} : { libc: metadata.libc }),
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(optionalDependencies === undefined ? {} : { optionalDependencies }),
    };
  }

  return {
    name: INSTALL_ROOT_NAME,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}
