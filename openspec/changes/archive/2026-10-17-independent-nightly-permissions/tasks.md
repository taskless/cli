## 1. Project permission rules

- [x] 1.1 Scope removal in `syncPermissions()` to the installed invocation's package, keep the other package's recorded rules, and remove no package rules for an invocation that names neither; verify `permissions.test.ts` covers side-by-side installs, a nightly upgrade, record carry-over, and a `self` invocation

## 2. Global trust entry

- [x] 2.1 Give each package its own entry and label in `global-trust.ts`, select by build target, and detect, replace, describe, and warn by this build's label; verify `global-trust.test.ts` and a `nightly`-project test cover both entries leaving each other alone
- [x] 2.2 Spell the entry and label as placeholders in `skills/taskless/SKILL.md`, rendered by `writeCanonicalSkill()`; reword the `stale` state in `src/agent/init.md`; verify `installed-documentation.test.ts` and the nightly skill test

## 3. Release

- [x] 3.1 Add a `patch` changeset; run `pnpm typecheck`, `pnpm lint`, and the full test suite
- [x] 3.2 Run the pre-archive scenario check from CLAUDE.md, then archive the change
