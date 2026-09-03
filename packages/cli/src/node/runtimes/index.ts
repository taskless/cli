/**
 * Public entry for `@taskless/cli/node/runtimes`.
 *
 * Where the engine binaries this CLI executes actually live on this host, and
 * how to find them. It is the CLI's own resolver and the CLI's own package
 * specs — not a copy kept in step, the actual modules — so a consumer that
 * installs this package resolves the same ast-grep and the same Vale that
 * `taskless check` would run.
 *
 * ## Why this is published
 *
 * A service that verifies a generated rule has to execute it, and a rule's
 * behaviour is a property of the engine version that runs it, not of the
 * version it was written against. ast-grep in particular changes what a capture
 * matches across minors: a rule verified under one and executed under another
 * can verify clean and then match nothing, which is a rule that passes its gate
 * and never fires. Nothing reports that, because both sides succeeded.
 *
 * The alternative to importing this is pinning the engine version by hand
 * alongside the CLI version, in a second place, and keeping the two in step.
 * They drift, and the drift is silent in exactly the direction that matters.
 * Installing this package and asking it where the binary is makes the engine
 * version a consequence of the CLI version rather than a parallel fact: the
 * pinned platform packages arrive as this package's own optional dependencies,
 * and they move when the pin moves.
 *
 * ## This entry requires Node, and says so in its path
 *
 * `node/` is in the specifier deliberately. Resolution spawns each candidate to
 * make it identify itself, reads the filesystem, and consults `PATH`, so this
 * graph reaches `node:child_process`, `node:fs`, `node:module`, `node:path` and
 * `node:url`. It will not run on a Worker or in a browser, and the import path
 * says that before a build error has to.
 *
 * This is the difference between this entry and `@taskless/cli/prompts` and
 * `@taskless/cli/layout`, which are host-free and whose builds fail if their
 * graphs ever reach a host capability. Every published entry is classified as
 * one or the other in `vite.config.ts`, and the build fails on an export
 * belonging to neither, so this exemption is a declaration rather than an
 * omission.
 *
 * ## Resolution reports a miss as a value, and each side decides what it means
 *
 * {@link resolvePlatformBinary} returns `{ path: undefined, tried }` when no
 * candidate verified. It does not throw, and that is deliberate rather than
 * incidental: `taskless check` runs several engines, and a host without Vale
 * installed must lose the Vale rules rather than the whole run. Encoding "not
 * found" as a value is what lets a caller choose.
 *
 * A verifier should choose the opposite. A sandbox whose optional dependency
 * did not install resolves `undefined` for the same reason a developer's laptop
 * does — nothing is there — but the consequence is not a skipped engine, it is
 * a verification that ran no engine and reported success. Fail closed on
 * `undefined`, and use `tried` to say where you looked:
 *
 * ```ts
 * import {
 *   AST_GREP_BINARY,
 *   resolvePlatformBinary,
 * } from "@taskless/cli/node/runtimes";
 *
 * const { path, tried } = resolvePlatformBinary(AST_GREP_BINARY);
 * if (path === undefined) {
 *   throw new Error(`ast-grep not resolved. Looked in: ${tried.join(", ")}`);
 * }
 * ```
 *
 * ## What a resolved path is, and is not
 *
 * It is a path that exists and that answered `--version` with output matching
 * the spec's `identity`, so it is the binary and not a placeholder a failed
 * install left behind. It is not a promise about which version answered: the
 * first candidate tried is the pinned platform package, but a host that only
 * has the engine on `PATH` resolves that instead. Read `--version` yourself if
 * the version is what you are relying on.
 */

// The `.js` extensions are deliberate, for the same reason they are on the
// prompts and layout entries: this module is a published entry, so `tsc` copies
// these specifiers verbatim into `dist/node/runtimes/index.d.ts`, where an
// extensionless specifier fails to resolve for a consumer on
// `moduleResolution: node16`/`nodenext`.
export {
  findOnPath,
  isPlatformBinary,
  pathCommandName,
  platformPackageName,
  resolvePlatformBinary,
  type PlatformBinaryResolution,
  type PlatformBinarySpec,
} from "../../rules/platform-binary.js";
export { AST_GREP_BINARY } from "../../rules/ast-grep-binary.js";
export { VALE_BINARY } from "../../rules/vale/binary.js";
