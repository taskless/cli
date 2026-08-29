## Why

`.taskless/README.md` is written into the user's repository and overwritten on
every migration run, so it is shipped content rather than a console line. It
hardcodes `@taskless/cli@latest`, which means a nightly writes a README telling
its reader to install the released package over the nightly they installed
minutes earlier to exercise unreleased behavior.

This is the third surface where the same defect has surfaced: skill and command
stubs were taskless/cli#200 and #202, and the `agent` topic index carries an
unrouted invocation of its own.

The README is the one that could not be fixed by routing it through
`applyCliInvocation`. That rewrite understands `npx @taskless/cli` and
`npx @taskless/cli@latest` and nothing else, and the README shows two
launchers. Routing it would have corrected the `npx` line and left the
`pnpm dlx` line naming the release, which reads as fixed and is worse than two
consistently wrong lines.

## What Changes

- **The README takes the build's package specifier, and both launchers use
  it.** The invocation has two halves that come from different places
  (`util/package-manager.ts`): the **specifier** is a build-time fact, the
  **launcher** is a runtime one. Only the specifier was ever wrong, so only the
  specifier changes. A nightly writes `@taskless/cli-nightly@<version>` on both
  the `pnpm dlx` and the `npx` line.
- **The launcher menu stays, in every build.** This file is written once and
  read much later by someone who may reach for either package manager. It is
  not resolved by runtime launcher detection, which would make the bytes depend
  on how a given run happened to be launched, in a file many projects commit
  and the migration rewrites every run. Detection also legitimately answers
  "unknown" for `pnpm run`, a global install, bare `node`, yarn, and bun.
- **A path-form (`self`) build names its one invocation.** It is reachable by
  no package specifier, and `pnpm dlx node packages/cli/dist-self/index.js` is
  not a command, so there is no launcher to choose between.
- **The `agent` topic index routes its human-facing hint** through
  `applyCliInvocation`, which is all that site needs: the whole literal is the
  invocation, in the one spelling the rewrite understands.
- **An ast-grep rule guards the class at authoring time.** A string literal
  under `packages/cli/src/` that names the released package, outside a call to
  `applyCliInvocation`, is reported.

`applyCliInvocation` is deliberately not taught the `pnpm dlx` spelling. Its
contract is "rewrite the canonical invocation", and a launcher is not part of
the canonical invocation; the specifier is already available on its own, from
the function that exists to supply exactly that half.

`prompts/recipes.ts` and its `<taskless-cli>` marker are unchanged. A recipe's
reader is an agent that can be asked to supply the launcher it has, which beats
naming one it may not, and that module is imported by Workers without
`nodejs_compat` where a module-scope `process` read throws at import time.

**Delivery is a single PR.** One README producer, one printed line, one lint
rule, tests, and a spec delta. No unit of this is meaningful on its own.

## Capabilities

### Modified Capabilities

- `cli-taskless-bootstrap`: the scaffold README names the package specifier the
  running build is actually reachable by, on every launcher it lists.

## Impact

- **Modified**: `packages/cli/src/filesystem/migrations/0001-init.ts`
  (`buildReadmeContent`, `usageBlock`), `packages/cli/src/commands/agent.ts`
  (the human-facing hint), `packages/cli/src/util/package-manager.ts`
  (`pinnedSpecifier` exported, stale `dev` mention removed).
- **Added**: `packages/cli/test/scaffold-readme.test.ts`,
  `.taskless/rules/sg/no-unrouted-cli-invocation/`.
- **Unchanged**: a prod build's README bytes, which are identical to before;
  `prompts/recipes.ts`; the canonical store and its stubs.

**Tracking:** taskless/cli#203
