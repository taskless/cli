---
"@taskless/cli": patch
---

Make `--help` work on every command, instead of running the command.

`taskless check --help` printed no usage — it ran `check`. So did every other
subcommand: `--help` was parsed as an unrecognized flag and the command body
executed anyway, which meant asking `init` how it works installed skills, and
asking `check` how it works migrated the `.taskless/` scaffold. The only place
help worked was the bare `taskless --help`, whose own output tells you to run
`taskless <command> --help`.

`--help` and `-h` are now recognized at every depth, including nested commands
(`taskless auth login --help` describes `login`, not `auth`), and a working
directory passed before the command (`taskless -d ./repo check --help`) no
longer confuses which command you asked about. The usage text itself is
unchanged, and nothing else about how commands run has changed.
