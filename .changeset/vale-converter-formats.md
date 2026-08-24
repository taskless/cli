---
"@taskless/cli": patch
---

Stop one AsciiDoc file from disabling every Vale rule in the project.

Vale supports AsciiDoc, reStructuredText, XML/DITA and MDX, but it parses none
of them by itself — it shells out to `asciidoctor`, `rst2html`, `dita` or
`mdx2vast`, and the `@taskless/vale-*` packages ship the binary with none of
those alongside it. On a host without the converter Vale does not skip the file:
it prints one `E100 [lintAdoc] Runtime error` on stderr, writes nothing at all to
stdout, and exits 2. The abort is Vale's own and it is not scoped to the file
that caused it, so every finding from every other file in the run was destroyed
before it was ever serialized. Measured against the example project, adding a
single `.adoc` took a check that reported five Vale findings across four files
down to zero — reported as a raw JSON blob among the results, and exiting 1 the
same way any ordinary failing check does.

`runVale` now excludes the converter-dependent extensions from Vale's own walk,
so the rest of the project is checked normally and the skipped files are named
in a notice that says which converter would put them back in scope. The tiers
live in one table in `rules/capabilities.ts` — the same record the agent recipes
render their format lists from — measured against the pinned binary rather than
transcribed from documentation. That is how `.asc` and `.rest`, a third AsciiDoc
spelling and a second reStructuredText one that crash identically and were in
neither bug report, ended up covered. Measurement also corrected four
extensions that a documentation reading had put in the wrong tier: `.tex`,
`.rmd`, `.mkd` and `.mkdn` are all read as plain text by this Vale, not parsed,
so excluding them would have dropped files Vale lints perfectly well. A
per-extension test re-measures every row against the real Vale — each tier by
the property only that tier has, since ordinary prose fires in all of them — so
a version bump that moves a format between tiers fails there instead of silently
turning the engine off again.

The engine moves to Vale 3.18.0 in the same release, and the table carries a
standing instruction to re-measure every row on a version bump — so every row
was re-probed against the new binary rather than carried over. Eight moved.
`.mdx` gains a native parser and leaves the unsupported tier, so a matcher like
`[*.{md,mdx}]` — the worked example above — is legitimate again, and `[*.{md,typ}]`
takes its place as the broken one. `.typ` moved the opposite way: Typst now
parses through `typst2vast`, an external program this build does not ship, so a
Typst file is excluded from the run rather than read as prose the way 3.17.1
read it. `.rmd` and the new `.qmd` and `.myst` are parsed as markup, and `.qml`,
`.scss` and the new `.qdoc` are comment-aware where they previously fell through
to plain text.

The `.typ` move is the one that mattered to get right. An extension missing from
the table is read as prose, which is harmless — but the moment Vale routes it to
a converter, that same omission is a crash that takes down every Vale rule in
the run. Bumping the binary without re-measuring would have introduced exactly
the failure this table exists to prevent, under an extension nobody was
watching. Re-probing also caught one change the release notes do not mention:
PHP comment extraction now requires a real `<?php` tag, where 3.17.1 linted a
bare `//` comment without one.

Two details are load-bearing and were both wrong on the first attempt. Vale
honours exactly one `--glob` and keeps the last, so the `.taskless/` exclusion
and the format exclusions have to travel as one negated alternation or the first
is silently discarded. And Vale matches a `--glob` against the basename only
when the pattern contains no `/` — combined with `.taskless/**` the whole
expression goes path-wise, at which point a bare `*.adoc` stops matching
`docs/guide.adoc` and the crash survives one directory down from wherever it was
tested. Vale's error output is also decoded now rather than forwarded verbatim,
so a failure reads as a sentence naming the missing program instead of a
five-field JSON object.

**These formats are now stated as unsupported rather than as needing a tool.**
The notice used to end "Install it and put it on your PATH to have these files
checked", which offered a path this build does not ship, does not test, and for
`.xml` cannot deliver — an XSLT stylesheet is specific to the document, so no
install makes it lintable. It also made behaviour host-dependent: macOS ships
`/usr/bin/xsltproc` and typical Linux CI images do not, so the same repository
checked differently depending on the machine. The exclusion is unconditional
for that reason, and the programs are still named as the reason rather than as
a remedy.

The comment tier was reconciled against Vale's own documentation at
docs.vale.sh/formats/code, which adds `.bsh`, `.csx`, `.pod`, `.py3` and `.sbt`
once measured. It also documents `.pyi`, `.qml` and `.scss` as comment-aware,
and on 3.17.1 a bare non-comment line in each of them lints. 3.18.0 makes the
claim true for `.qml` and `.scss` and still not for `.pyi`, which stays in the
plaintext tier. That divergence is the argument for probing rather than
transcribing: the docs describe whatever Vale is current, and copying the list
would have shipped `.pyi` as comment-aware and been wrong for both builds. `.pod` is a reminder of how easily this is misread — it lints Perl
comments but not POD blocks, so probing it with `=head1` looks like no support
at all.
