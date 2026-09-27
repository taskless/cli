---
"@taskless/cli": patch
---

The setup wizard no longer asks "Log in to taskless.io now?". Setup needs no account, since local `sg` and `vale` rules run without one. `taskless auth login` is unchanged, and commands that need an account still say so.
