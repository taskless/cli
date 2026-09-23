---
"@taskless/cli": patch
---

A failing schema migration is now reported once instead of twice, and the message names the migration that refused. `runMigrations` used to print `Migration N failed: <message>` itself and then rethrow the original, so the caller printed the same text again without the migration number — the longer and more useful the refusal, the worse it read. The prefix now rides on the rethrown error, so there is one string and one printer, and the original `CLIError` code (for example `SCAFFOLD_CONFLICT`) is preserved.

`taskless init --json` also emits an error envelope when a migration fails. It previously wrote nothing at all to stdout and put prose on stderr, leaving a machine consumer with only the exit code; it now writes the standard `{ ok: false, code, message }` envelope, with the migration number in `message`.
