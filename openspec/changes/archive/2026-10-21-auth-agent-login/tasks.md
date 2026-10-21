## 1. Pending login state

- [x] 1.1 Add read/save/clear for `.taskless/.auth-pending.json` beside the token helpers (mode `0600`, added to `.taskless/.gitignore`, `expires_at` absolute); unit-test save → read → clear, and that an expired file reads as absent
- [x] 1.2 Add `AUTH_EXPIRED` to the error code enum; typecheck passes

## 2. Stepped login

- [x] 2.1 Implement the stepped flow against `DeviceFlowProvider`: start (request, save, return pending), continue (poll ≤45s honouring `interval`/`slow_down`, then authenticated / pending / denied / expired), silent restart on a code found expired; unit-test every branch with a fake provider and an injected clock
- [x] 2.2 Route `auth login --json` through it and print the success envelopes (`pending`, `authenticated`, `already_logged_in` with `source`); keep the interactive path unchanged; tests assert each envelope and exit code
- [x] 2.3 Clear a pending code on `auth logout` and on a successful interactive login; tests cover both

## 3. Recipe

- [x] 3.1 Rewrite the login branch of `src/agent/auth.md` to loop on `auth login --json`, add `AUTH_EXPIRED` to its error table, and bump the topic version from #562's v4 to v5; recipe tests pass

## 4. Verification

- [x] 4.1 `pnpm typecheck`, `pnpm lint`, and the CLI suite pass
- [x] 4.2 A real login against the service, driven only by repeated `auth login --json` calls, ends in `authenticated` and leaves no `.auth-pending.json` behind
