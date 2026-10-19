/**
 * The unpinned published invocation: the literal some content was written
 * with before invocations were pinned, and the rewrite anchor
 * {@link applyCliInvocation} replaces with this build's own invocation.
 *
 * No build bakes this string any more. Prod bakes `npx @taskless/cli@<version>`,
 * a nightly `npx @taskless/cli-nightly@<version>`, and `self` a repo-root
 * path. See `scripts/build-target.ts`, `vite.config.ts`, and the root
 * `package.json` scripts.
 */
export const PROD_INVOCATION = "npx @taskless/cli";

/**
 * Whether this is the released build.
 *
 * Read from the build target rather than by comparing the invocation to
 * {@link PROD_INVOCATION}: a release now bakes its own version, so the
 * invocation no longer equals the unpinned string, and a comparison would
 * quietly report every build as unreleased.
 *
 * `false` means a `nightly` or a `self` path. `true` means the released
 * package, which knows its version but not how it was launched (`npx`,
 * `pnpm dlx`, a `package.json` script).
 */
export function isProductionInvocation(): boolean {
  return __TASKLESS_BUILD_TARGET__ === "prod";
}

/** This build's invocation, whatever the target. */
export function buildInvocation(): string {
  return __TASKLESS_CLI__;
}

/** The token skill and command sources spell the CLI invocation with. */
export const INVOCATION_PLACEHOLDER = "%(TASKLESS_CLI)s";

/**
 * Render {@link INVOCATION_PLACEHOLDER} in an installed skill or command body
 * to `invocation`, this build's own by default. The canonical skill passes the
 * project launcher instead, for a build that has one.
 *
 * The same token the recipes use, so a reader of either source sees one
 * spelling. It is substituted as an exact token rather than rendered through
 * sprintf: the sources are prose with no other placeholders, and sprintf
 * would make a literal `%` in a markdown body a render error.
 *
 * This replaces searching the prose for the literal `npx @taskless/cli`
 * ({@link applyCliInvocation}), which is whitespace-sensitive: a wrapped line
 * or a doubled space left the literal in place, and a nightly install then
 * carried a skill telling its agent to run the release package. A token
 * either matches exactly or a test on the source notices it is missing.
 */
export function renderInvocationPlaceholder(
  content: string,
  invocation: string = __TASKLESS_CLI__
): string {
  return content.replaceAll(INVOCATION_PLACEHOLDER, invocation);
}

/**
 * Rewrite the unpinned `npx @taskless/cli` invocation to the build-target
 * invocation (`__TASKLESS_CLI__`).
 *
 * Every target rewrites, prod included, since every target now bakes a
 * pinned invocation. It swaps both the bare form and the `@latest` form (the
 * `@latest` form first, so the bare replacement can't leave a dangling
 * `@latest`, which would read `npx @taskless/cli@<version>@latest`).
 */
export function applyCliInvocation(content: string): string {
  return content
    .replaceAll(`${PROD_INVOCATION}@latest`, __TASKLESS_CLI__)
    .replaceAll(PROD_INVOCATION, __TASKLESS_CLI__);
}

/** Matches a leading YAML frontmatter block (`---\n…\n---\n`). */
const FRONTMATTER = /^(---\n[\s\S]*?\n---\n)/;

/**
 * Prepend the build-target notice (`__TASKLESS_CLI_NOTICE__`) to a canonical
 * skill/command body. A no-op for prod, where the notice is empty. For
 * `dev`/`self` builds the banner is inserted immediately after the frontmatter
 * block so it renders as the first body line without corrupting the YAML.
 */
export function withCliBuildNotice(content: string): string {
  if (__TASKLESS_CLI_NOTICE__ === "") return content;
  return FRONTMATTER.test(content)
    ? content.replace(FRONTMATTER, `$1\n${__TASKLESS_CLI_NOTICE__}\n`)
    : `${__TASKLESS_CLI_NOTICE__}\n\n${content}`;
}
