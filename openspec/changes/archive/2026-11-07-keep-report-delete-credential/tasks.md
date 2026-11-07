## 1. Record

- [x] 1.1 Move a taken record name to a `_N` suffix, never overwriting
- [x] 1.2 Throw `REPORT_RECORD_FAILED` carrying the URL and delete URL when the record cannot be written
- [x] 1.3 Carry the URL, delete URL and expiry in the `--json` error envelope

## 2. Recipe and tests

- [x] 2.1 List `REPORT_RECORD_FAILED` in the `report` recipe and bump it to topic v8
- [x] 2.2 Test a taken record name, and a record that cannot be written, in both output forms
