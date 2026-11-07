---
"@taskless/cli": patch
---

`taskless report --from` no longer loses a published report's delete URL when its local record cannot be written. Two publishes in the same second used to collide on the record's file name, leaving the second report live for 30 days with no way to delete it. A taken name now moves to a `_2`, `_3`, … suffix, which `--delete` accepts. If the record still cannot be written, the command exits with `REPORT_RECORD_FAILED` and prints the report's URL and delete URL, which the `--json` envelope also carries as `url` and `deleteUrl`.
