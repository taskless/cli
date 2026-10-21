## 1. Docs and the Vale rule

- [x] 1.1 Rewrite `docs-npx-cli` to refuse npx/dlx runs of any subcommand but `init`, keep the `pnpm cli` ban, and extend its scope to `dotagents.md`
- [x] 1.2 Rewrite its pass and fail fixtures, and confirm `verify` passes
- [x] 1.3 Move `README.md`, `packages/cli/README.md`, and `example/README.md` to the launcher, and update the rule's description in `README.md` and `CONTRIBUTING.md`

## 2. CLI output

- [x] 2.1 `init`'s upgrade trailer names `buildLauncherInvocation()` for `update`
- [x] 2.2 The bare non-interactive notice names the launcher for recipes when the project has one
- [x] 2.3 Tests: the trailer names `./.taskless/bin/cli.mjs update`; the bare notice names the launcher when one exists
