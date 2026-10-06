---
"@taskless/cli": patch
---

Onboarding now settles when the new rules run before it asks to mark itself complete. After the rules are materialized, the onboard recipe tells the user which CI systems and commit-hook tools the repository has, offers to wire `check` into CI (`agent ci`) and into a pre-commit hook (the new `agent hooks` topic), and asks the consent-gated mark-complete question on its own, so a "yes" can no longer be read as an answer to both. `detect --json` gains two additive fields for this, `ci` and `hooks`, read from configuration at the repository root.
