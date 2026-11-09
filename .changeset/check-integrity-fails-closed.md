---
"@taskless/cli": patch
---

`taskless check` no longer reports green when enforcement did not run, and no longer runs an engine binary of the wrong version.

- **A rejected token fails `check`.** When the rule service rejects the token (a revoked or mistyped `TASKLESS_TOKEN`), `check` still runs static rules unverified and skips runtime rules, and now exits 1 with a failure saying authentication was rejected. A rule service that cannot be reached stays non-fatal, so a Taskless outage does not turn CI red. (#655)
- **An edited runtime rule fails `check`.** A runtime rule whose signed files changed is answered `unsafe` and does not run, and now fails the run like an edited ast-grep or Vale rule does: the message moves from `notices` to `failures`. Restore it with `taskless rule restore <id>`. (#655)
- **`check` refuses an `sg` or `vale` binary of the wrong version.** When the pinned platform package is missing and `check` would fall back to a binary from `node_modules/.bin` or `PATH`, it now runs that binary's `--version` and refuses to scan when it differs from the engine version this CLI bundles, naming the binary's path and version. Pass `--allow-version-mismatches` to run it anyway. (#650)
- **`check --json` integrity entries are typed per verdict.** The `integrity` entry schema exported from `@taskless/cli/schemas` is now a union discriminated on `verdict`: `files` appears only on `unsafe` and `unknown`, `revisionId` only on `missing`, and `copyOf` only on `unknown`. Output is unchanged, but TypeScript importers of the schema see a narrower type and must check `verdict` before reading a verdict-specific field. (#647)
