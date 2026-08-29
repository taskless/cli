/**
 * The published CLI invocation baked into skill, command, and recipe source.
 * Build targets other than prod rewrite it: to a repo-root-relative path so a
 * locally built CLI can be dogfooded in this repo (`build:self`), and to
 * `npx @taskless/cli-nightly@<version>` for a nightly, whose shipped
 * instructions must name the package the reader actually installed rather than
 * the released one. There is no target that emits a path usable from outside
 * this checkout; a nightly covers that. See `scripts/build-target.ts`,
 * `vite.config.ts`, and the root `package.json` scripts.
 */
export const PROD_INVOCATION = "npx @taskless/cli";

/**
 * Whether this build's invocation is the released one.
 *
 * `false` means the build knows exactly what it is — a `nightly` pinned to its
 * published version, or a `self` path — and its instructions must say so
 * rather than naming `@taskless/cli`. `true` means the build is the released
 * package and has no idea how it was launched, which is a different situation
 * from knowing it was launched as `npx @taskless/cli`.
 */
export function isProductionInvocation(): boolean {
  return __TASKLESS_CLI__ === PROD_INVOCATION;
}

/** This build's invocation, whatever the target. */
export function buildInvocation(): string {
  return __TASKLESS_CLI__;
}

/**
 * Rewrite the canonical `npx @taskless/cli` invocation to the build-target
 * invocation (`__TASKLESS_CLI__`).
 *
 * A no-op for prod builds, where the define equals {@link PROD_INVOCATION}, so
 * emitted content stays byte-identical to source. For `dev`/`self`/`nightly`
 * builds it swaps both the bare form and the `@latest`-pinned form (the
 * version-pinned form first, so the bare replacement can't leave a dangling
 * `@latest` — which for a nightly would read
 * `npx @taskless/cli-nightly@<version>@latest`).
 */
export function applyCliInvocation(content: string): string {
  if (isProductionInvocation()) return content;
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
