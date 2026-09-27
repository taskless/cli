## Context

`planRuntime` (`rules/runtime/plan.ts`) turns a reconcile outcome into
`{ execute, skipped, notices }`. `selectBlessedRuntimeRules` splits signed rules
into `blessed` (signature in `run`) and `withheld` (everything else), and every
`withheld` rule gets the same skip reason. `check` derives its exit code from
`runEngines` alone, so no skip, of any kind, can fail a run.

That was correct while every non-`run` outcome was either advisory (`unknown`,
`missing`) or self-repairing (`unsafe`, restored for the next run). An
entitlement withhold is neither: it is the server deliberately declining to run
a rule the user believes is protecting them, and it will keep declining on every
run until someone acts.

## Decisions

### 1. Withheld fails the run; the degrade paths still do not

The standing spec says `check` SHALL NOT change the exit code because runtime
rules were skipped on an **unverified** path (logged out, `--anonymous`,
reconcile unreachable). Withheld is not that. Reconcile completed, the server
answered, and the answer was "these will not run for you". Failing on it does
not reopen the question of whether an outage should break CI.

Exit code **1**, the code `check` already uses for error findings and engine
failures. A distinct code was considered and rejected: every existing CI recipe
treats non-zero as failure, the JSON envelope's `entitlement` field is the
machine-readable discriminator, and a new code is a contract we would have to
keep.

`success` in `--json` is `false` whenever the exit code is non-zero, as today.

### 2. Match withheld entries to local rules by reported path

`entitlement.withheld` carries `{ ruleId, file }` and no signature, so the
signature join `run` uses is not available. `file` is the path the CLI itself
reported (the reported-path requirement already makes it contractual), so the
join is exact: a signed rule whose reported `check.ts` path is in `withheld`
is withheld for entitlement; every other non-`run` rule keeps today's reason.

A `withheld` entry that matches no reported file is ignored for the skip list
but still counts toward failing the run. The server said something will not
run; the CLI not being able to name it locally is not a reason to go green.

### 3. The entitlement object is parsed, not trusted

`reconcile` normalizes `entitlement` into
`{ runtimeSignatures: false; reason?; upgradeUrl?; withheld: [...] } | undefined`.
It is `undefined` when the field is absent, not an object, or
`runtimeSignatures` is not literally `false`. `withheld` entries without a string
`file` are dropped. `upgradeUrl` is surfaced only when it parses as an absolute
`https:` URL, so a malformed value is never printed as a link.

Only `withheld` drives the exit code. `runtimeSignatures: false` with an empty
`withheld` (an unentitled org reporting no matching runtime files) passes, since
nothing the user holds was declined.

### 4. One message, printed once

Human output prints one notice per run naming the reason, the withheld rule
names, and the upgrade URL, rather than repeating the URL per rule. Each rule's
`skipped` entry gets the short reason `"not included in your Taskless plan"`
so `--json` consumers reading `skipped` alone still see the right cause.

### 5. Write-time warnings ride the existing notice channels

`rule create` / `rule improve` already collect `notices` and print them as
`Warning:` in human mode; restore notices already flow into `plan.notices`. The
entitlement warning is one more entry in each, so no new output channel and no
schema change beyond `check`'s `entitlement` field.

The restore and retrieval responses are typed from the generated schema, which
does not yet carry `entitlement`. They are widened with `MayCarryEntitlement<T>`
(the field as optional `unknown`) and read through the same normalizer as
reconcile, so the CLI ships assuming the field MIGHT be there instead of waiting
on #207's deploy. Tightening that once the service always sends it is #409.

## Risks

- **A server bug that lists a file in `withheld` for an entitled org fails CI.**
  Accepted: failing closed is the property runtime rules exist for, and the
  failure names its cause and the URL to check.
- **The vendored schema is stale in an unrelated way.** A refresh on 2026-09-27
  also changes `successCases`/`failureCases` and drops `signature` from the
  `sg`/`vale` file-set variants (the `runtime` variant keeps it). The cloud will
  restore those signatures; regeneration waits for that (#409).
