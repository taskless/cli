---
"@taskless/cli": patch
---

`info --json` now includes `install.onboarded`, matching the field the
`onboard` recipe already instructs agents to read from that command. Before
this, the field was written to `.taskless/taskless.json` and enforced by
`onboard`'s own gate, but omitted from the `info --json` payload, so an agent
following the recipe read `undefined` and re-ran a full discovery pass on a
project that had already onboarded. A manifest that omits the field now
reports `onboarded: false`, matching the strict-equality gate `onboard`
itself applies, rather than `null` or leaving the key out.
