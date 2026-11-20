import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Where Vale's tree-sitter grammars are published.
 *
 * Since Vale 3.27.0 the grammars Vale uses to find comments in source code are
 * WebAssembly modules shipped apart from the binary, and Vale normally installs
 * them with `vale sync`. Without them it finds comments by their delimiters,
 * which lints a `//nolint` directive as prose and misses a one-line CSS
 * `/* … *\/` comment. `@taskless/vale-grammars` carries every grammar upstream
 * publishes for the pinned Vale release, as one package for every platform,
 * and the CLI pins it at the same exact version as the binary packages.
 *
 * Vale is told where they are through `VALE_GRAMMARS_PATH`, which it reads for
 * any grammar the StylesPath does not hold, one grammar at a time.
 */
export interface ValeGrammarsSpec {
  /** Human-readable name, for messages. */
  label: string;
  /** The npm package that carries the grammar modules. */
  packageName: string;
  /** The directory inside that package that holds `<name>.wasm` files. */
  directory: string;
}

export const VALE_GRAMMARS: ValeGrammarsSpec = {
  label: "Vale grammars",
  packageName: "@taskless/vale-grammars",
  directory: "grammars",
};

/**
 * The grammar directory, or why there is none.
 *
 * A miss is a value, not a throw, for the reason the binary resolver's is:
 * `check` keeps running Vale without grammars (its `grammar … is not
 * installed` warnings then reach the user as notices), while a verifier may
 * want to fail closed. Each caller decides.
 */
export interface ValeGrammarsResolution {
  /** Absolute path of the directory to name to Vale, or `undefined`. */
  path: string | undefined;
  /** Locations searched, in order, for an actionable message. */
  tried: string[];
}

/**
 * Locate the grammar directory of the installed grammar package.
 *
 * A directory that exists but holds no `.wasm` module is rejected: an empty or
 * half-extracted install would otherwise be named to Vale and behave exactly
 * like no grammars at all, with nothing saying why.
 */
export function resolveValeGrammars(
  spec: ValeGrammarsSpec = VALE_GRAMMARS
): ValeGrammarsResolution {
  const tried = [`${spec.packageName}/${spec.directory}`];
  let directory: string;
  try {
    const require = createRequire(import.meta.url);
    directory = resolve(
      dirname(require.resolve(`${spec.packageName}/package.json`)),
      spec.directory
    );
  } catch {
    return { path: undefined, tried };
  }
  tried[0] = directory;
  try {
    const hasModule = readdirSync(directory).some((entry) =>
      entry.endsWith(".wasm")
    );
    return { path: hasModule ? directory : undefined, tried };
  } catch {
    return { path: undefined, tried };
  }
}

/**
 * Resolution is cached for the process, a miss included, so every Vale run in
 * one `check` names the same directory without repeating the search.
 */
let cached: ValeGrammarsResolution | undefined;

/** The grammar directory the CLI names to Vale, cached for the process. */
export function findValeGrammars(): ValeGrammarsResolution {
  cached ??= resolveValeGrammars();
  return cached;
}

/** Reset the process cache. Tests only. */
export function resetValeGrammarsCache(): void {
  cached = undefined;
}
