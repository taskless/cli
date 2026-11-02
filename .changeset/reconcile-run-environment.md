---
"@taskless/cli": patch
---

Reconcile now tells Taskless whether it is running in CI. Every `POST /cli/api/v2/reconcile` carries `environment: { ci, provider? }`, using the CI detection telemetry already performs (`provider` is the hyphenated name, such as `github-actions`, when it is recognized). The service uses it only to record when a repository last reconciled from CI, which drives the dashboard's "CI set up" indicator; verdicts, entitlements and output are unchanged, and a local run sends `ci: false`.
