## 1. Delivery

- [x] 1.1 Add `writePreparedRules`, which stages every rule under `.taskless/` and moves each into place, rolling back on failure
- [x] 1.2 Write a request's rules through it in `deliverRevisions`, reporting a write failure as `RULE_GENERATION_FAILED`
- [x] 1.3 Test a two-rule request whose second write fails, with the first rule both new and replacing an older version
