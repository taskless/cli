---
"@taskless/cli": patch
---

Calls the rule service's renamed `/cli/api/request` paths instead of the
deprecated `/cli/api/rule` family.

The id was never a rule id. `POST` returns a ticket, `GET` returns N rules each
carrying their own `id`, and the service's own spec, its `meta.ticketId` field
and its SQL all called it a ticket — the route was the outlier. Both identifiers
still ride every response and the legacy paths still serve, so nothing changes
for anyone; this moves the CLI's calls before the deprecation window closes.

`generate:api` now vendors the API's OpenAPI document to
`src/generated/api.schema.json` alongside the generated types, so a contract
change arrives as a readable diff rather than only as regenerated declarations,
and a test reads that document to fail if any source file still calls a path the
API marks deprecated.
