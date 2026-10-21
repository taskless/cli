## 1. Stdout-only colour detection

- [x] 1.1 In `util/color.ts`, return level 0 when stdout is not a terminal, regardless of stderr. Verify where each chalk consumer writes: `install/notice-box.ts`, `commands/share.ts`, `commands/onboard.ts`, and the wizard summary write to stdout; the wizard banner (`wizard/index.ts`) and the `init --json` permission and global-trust output (`install/settings-tone.ts`) write to stderr, and the proposal names them as the trade-off.
- [x] 1.2 Add `color.test.ts` cases for stdout redirected with stderr on a terminal (level 0) and stderr redirected with stdout on a terminal (coloured).
- [x] 1.3 Restate the onboarding trailer requirement in `cli-init` with the stdout-only rule; extend `.changeset/onboard-trailer-copy-prompt.md` rather than adding a second changeset.
- [x] 1.4 Run `pnpm typecheck`, `pnpm lint`, and the CLI tests; all pass.
