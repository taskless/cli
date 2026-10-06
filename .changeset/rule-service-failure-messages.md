---
"@taskless/cli": patch
---

Rule service failures now say what went wrong and whether to retry. A network failure names its cause (for example `getaddrinfo ENOTFOUND`) instead of `fetch failed`, and a network failure, `408`, `429`, or `5xx` adds advice to try again. `check` no longer describes a request the service rejected, such as `validation_error`, as the service being unavailable. `rule restore`, `rollback`, and `revisions` report `validation_error` as `INVALID_INPUT` with the service's details, where they previously reported `NETWORK_ERROR`. Every plan refusal now shows the upgrade link, including on `rule create`, `rule improve`, and fetching a generated rule.
