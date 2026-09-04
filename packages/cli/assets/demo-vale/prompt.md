Create a rule that flags the word "utilize" in markdown documentation and
suggests "use" instead.

"Utilize" is longer than "use" and means the same thing in nearly every
sentence a reader will meet. It should match case-insensitively and cover the
inflected forms.

This is a prose rule. It applies to markdown, and it must not look at source
code.

Prose that should NOT be flagged:

```md
Use the installer to write the config file.
```

Prose that SHOULD be flagged:

```md
Utilize the installer to write the config file.
```
