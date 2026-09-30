---
"@taskless/cli": patch
---

`check` no longer skips Vale target files over 128 KB. The guard
(`VALE_MAX_FILE_BYTES`, added in 0.11.2) was written against Vale 3.20.0,
whose lint time grew superlinearly with the size of a single Markdown block,
so one large file could consume the run's whole timeout and, because Vale
writes nothing until the run finishes, cost every other file its findings.
The same release moved the vendored Vale to 3.21.0, whose perf work makes that
cost linear regardless of block structure, so the cap no longer separates a
cheap file from an expensive one. Re-measured on the reproduction from
taskless/cli#325 against the vendored 3.21.0 binary (darwin/arm64, warm, median
of three):

| fixture                         | Vale 3.20.0 | Vale 3.21.0 |
| ------------------------------- | ----------- | ----------- |
| 3.2 MB, one block (`huge.md`)   | ~81,000 ms  | ~230 ms     |
| 3.2 MB, blank-line separated    | ~4,400 ms   | ~290 ms     |
| 128 KB, one block (the old cap) | ~770 ms     | ~26 ms      |
| 25 MB, one block                | —           | ~2,200 ms   |

What a user sees: a file that 0.11.2 named in a `Vale did not check N file(s)
over 131072 bytes` notice is linted again and produces findings; the notice is
gone. The per-file retry for a target whose front matter Vale cannot parse
(taskless/cli#300) is unchanged, as is the 60 s run timeout. Vale still emits
nothing until the run completes, so a run killed by an external time limit
still loses every finding; with linear cost that takes a file in the hundreds
of megabytes rather than the hundreds of kilobytes.
