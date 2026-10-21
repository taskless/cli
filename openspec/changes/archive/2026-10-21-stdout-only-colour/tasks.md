## 1. Stdout-only colour detection

- [x] 1.1 In `util/color.ts`, return level 0 when stdout is not a terminal, regardless of stderr. Verify every chalk consumer (`wizard/intro.ts`, `wizard/steps/summary.ts`, `install/notice-box.ts`, `install/settings-tone.ts`, `commands/share.ts`, `commands/onboard.ts`) writes its coloured output to stdout.
- [x] 1.2 Add `color.test.ts` cases for stdout redirected with stderr on a terminal (level 0) and stderr redirected with stdout on a terminal (coloured).
- [x] 1.3 Restate the onboarding trailer requirement in `cli-init` with the stdout-only rule; extend `.changeset/onboard-trailer-copy-prompt.md` rather than adding a second changeset.
- [x] 1.4 Run `pnpm typecheck`, `pnpm lint`, and the CLI tests; all pass.
