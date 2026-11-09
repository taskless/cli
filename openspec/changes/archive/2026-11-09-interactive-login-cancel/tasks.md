## 1. Shared pending-login check

- [x] 1.1 Add a `mode` field to the pending login, and move the step's "still pending" check into `pending-login.ts` beside a clear that only removes the caller's own login
- [x] 1.2 Have a `--json` step replace an interactive pending login rather than poll it

## 2. Interactive login

- [x] 2.1 Record the interactive login as pending when it starts, check it after every poll, and return `cancelled` without saving a token once it is gone or replaced
- [x] 2.2 Clear the pending login on finish only while it is still this login's own
- [x] 2.3 Map an interactive `cancelled` to `AUTH_REQUIRED` with the step's message, and clear the pending login before the token on logout
- [x] 2.4 Update the `auth` recipe and bump its topic version

## 3. Tests

- [x] 3.1 Interactive: logout during the wait, then approval, saves no token and returns `cancelled`
- [x] 3.2 Interactive: a replacing login started by another process is left alone
- [x] 3.3 Interactive command: a cancelled login fails with `AUTH_REQUIRED` and captures no `cli_authenticated`
- [x] 3.4 Step: an interactive pending login is replaced, not polled
