import type { PlatformBinarySpec } from "./platform-binary";

/**
 * ast-grep's per-platform packaging, as the shared resolver understands it.
 *
 * `toolchainSuffix: true` is what produces `@ast-grep/cli-linux-x64-gnu` and
 * `-win32-x64-msvc`. The Vale packages set it false; see
 * {@link PlatformBinarySpec} for why that distinction is load-bearing.
 *
 * Both `ast-grep` and `sg` are listed because the wrapper declares them as bin
 * entries for the same target, so either may be what got linked. `ast-grep`
 * leads because it is the name the platform package ships the binary under; the
 * resolver reverses the list at the link-based tiers, so `sg` is still tried
 * first there and named in the PATH advice, as it was before the shared
 * resolver existed.
 *
 * ## Why this sits in its own module rather than in `scan.ts`
 *
 * The spec is data: five fields describing how a package is named and how the
 * binary identifies itself. `scan.ts` is the scanner — it reaches
 * `rules/engines.ts`, and through it `node:fs/promises` and the CLI's error
 * type. `@taskless/cli/node/runtimes` publishes this spec so a consumer can
 * resolve the same binary the CLI executes, and a consumer that wants a path
 * has no business loading a scanner to get one. Vale's spec is already a leaf
 * for the same reason: `rules/vale/binary.ts` imports nothing but the resolver.
 */
export const AST_GREP_BINARY: PlatformBinarySpec = {
  label: "ast-grep",
  packagePrefix: "@ast-grep/cli",
  toolchainSuffix: true,
  binaryNames: ["ast-grep", "sg"],
  identity: /ast-grep/i,
};
