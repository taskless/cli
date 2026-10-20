---
"@taskless/cli": patch
---

Interrupting `taskless check` with Ctrl-C or SIGTERM now reliably removes the run's `.taskless/.run/` directory. Before this fix, a log entry that was still being written could recreate its file mid-removal, and the directory was left behind until a later run swept it.
