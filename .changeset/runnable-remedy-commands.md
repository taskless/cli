---
"@taskless/cli": patch
---

Messages that tell you what to run now print a command you can run as shown. They used to hard-code `taskless`, which is usually not on `PATH` when the CLI was launched with `npx @taskless/cli` or `pnpm dlx`. They now use the same launcher-aware prefix the authentication and rule-recovery errors already used, for example `npx @taskless/cli@latest auth login`. This covers `auth`, `check`, `rule create`/`improve`/`meta`, `onboard`, `agent`, `feedback send`, the install wizard, the non-interactive banner, and the Vale and missing-fixture notices. `check` with no rules now also names the `--from` that `rule create` requires.
