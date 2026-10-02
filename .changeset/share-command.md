---
"@taskless/cli": patch
---

`taskless share` prints the Taskless banner over a scannable QR code for taskless.io, with `npx @taskless/cli` beneath it, for showing Taskless to someone in person. The link carries `utm_source=cli`, `utm_medium=share`, and the CLI's base version as `utm_content`, so a visit is credited to the command and to the release that sent it. `--json` prints the URL instead.
