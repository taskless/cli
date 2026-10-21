## 1. Copyable onboarding trailer

- [x] 1.1 Add `.changeset/onboard-trailer-copy-prompt.md` (`patch`).
- [x] 1.2 Rewrite `getOnboardTrailer()` in `commands/onboard.ts` as an explanation line plus `ONBOARD_PROMPT` alone on the final line, coloured with chalk after importing `util/color`. Verify both `init` and the wizard still call it unchanged.
- [x] 1.3 Add unit tests for the plain trailer (chalk level 0: two lines, the last exactly the prompt) and the coloured trailer (only the prompt line carries escapes, its text unchanged). Update `init-no-interactive.test.ts` to the new wording and assert the prompt is the final line of stdout.
- [x] 1.4 Run `pnpm typecheck` and `pnpm lint`; both pass.
