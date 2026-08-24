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

The recipes now say MDX is not supported _yet_, rather than unsupported: Vale
3.18.0 parses it natively and a CLI update carrying that Vale is expected to
bring it. The same release adds a Typst converter, which will move `.typ` out of
the plaintext tier, so the table carries a standing instruction to re-measure
every row on a version bump.

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
and on the pinned 3.17.1 a bare non-comment line in each of them lints — so they
stay in the plaintext tier. That divergence is the argument for probing rather
than transcribing: the docs describe the current Vale, this build pins an older
one, and copying the list would have shipped `.scss` as comment-aware and been
wrong. `.pod` is a reminder of how easily this is misread — it lints Perl
comments but not POD blocks, so probing it with `=head1` looks like no support
at all.
