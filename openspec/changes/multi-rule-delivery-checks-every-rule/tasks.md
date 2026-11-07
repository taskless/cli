## 1. Delivery

- [x] 1.1 Split `writeServedRule` into `prepareServedRule` (no writes) and `writePreparedRule`, keeping `writeServedRule` for `rule restore`
- [x] 1.2 Check every rule in `deliverRevisions` before writing the first, and report a refusal as `RULE_GENERATION_FAILED`
- [x] 1.3 Test a two-rule request whose second rule has an unknown engine, an unsafe path, or an incomplete set
