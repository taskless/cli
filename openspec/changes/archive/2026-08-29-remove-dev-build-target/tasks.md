Delivery shape: **single PR**. One build target spelled out across a dozen files; a partial removal leaves a build that does not run. Spec, implementation, and archive land together.

## 1. Build machinery

- [x] 1.1 Drop `OUT_DIRS.dev` and the `dev` case from `resolveCliInvocation`
- [x] 1.2 Reject `TASKLESS_BUILD_TARGET=dev` in `resolveBuildTarget` rather than falling back to prod
- [x] 1.3 Drop the `dev` branch of `resolveCliNotice`
- [x] 1.4 Remove `build:dev` from `package.json` and `packages/cli/package.json`

## 2. Tooling configuration

- [x] 2.1 Remove `dist-dev/**` from `turbo.json` outputs
- [x] 2.2 Remove `**/dist-dev/` from `eslint.config.js` and `.gitignore`
- [x] 2.3 Remove `dist-dev` from the root and CLI `tsconfig.json` excludes

## 3. Prose

- [x] 3.1 Update comments in `vite.config.ts`, `tsconfig.prompts.json`, and `src/util/invocation.ts`
- [x] 3.2 Update the README build-target table and surrounding text
- [x] 3.3 Strengthen the `CONTRIBUTING.md` nightlies paragraph to state the trade plainly

## 4. Tests

- [x] 4.1 Replace the dev-target assertions with a rejection test
- [x] 4.2 Narrow the per-target parameterised lists to prod/self/nightly

## 5. Verification

- [x] 5.1 `pnpm build`, `pnpm build:self`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [x] 5.2 `pnpm openspec validate --all --strict`
- [x] 5.3 `pnpm cli check` shows no new Vale findings
- [x] 5.4 No changeset: a development build target is removed and the published package's behavior does not change
