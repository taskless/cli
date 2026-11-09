---
"@taskless/cli": patch
---

`auth logout` now cancels an interactive `auth login` that is waiting in another shell. Before, approving that login afterwards saved a token and logged the repository back in. The waiting login now fails with `AUTH_REQUIRED` and saves nothing, and finishing an interactive login no longer deletes a `--json` login another process started meanwhile. When an interactive login's code expires, it is now reported the same way as under `--json` (`AUTH_EXPIRED`, not `NETWORK_ERROR`), and the message says to run `auth login` again for a new code.
