---
"@taskless/cli": patch
---

Onboarding now covers a busy repository's whole review window. The review-comment source names the 1000-result cap of `gh pr list` and `gh search`, gives ready commands to count the window, list it by date range, and fetch every inline review comment since the window opened through `gh api --paginate`, and says to sample evenly across the window rather than read the newest pull requests. GitLab gets the same whole-window guidance through `glab api --paginate`. The scan step now has the agent record each counted comment under its candidate while mining, so `surfaced` comes from that record instead of a second read.
