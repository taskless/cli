---
"@taskless/cli": patch
---

`rule create` and `rule improve` no longer give up on the first transient failure while waiting for a generation request or fetching the rules it produced. A network failure, `408`, `429`, or `5xx` is retried on the next 15-second poll, and the command fails only after 8 in a row. A rejected token, a documented error, or a response the CLI cannot read still fails immediately.

Both commands now take `--resume <requestId>` to pick up a request a previous run submitted, instead of submitting a new one. When a command gives up, its message names the request id, says the request may still complete on the service, and gives the `--resume` command to run.
