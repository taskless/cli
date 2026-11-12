---
"@taskless/cli": patch
---

`route` (topic v11) and `onboard` (topic v12) now give one answer to "may I ask the user here?". `route` says that a recipe which limits questions, such as `onboard`, overrides its step 7 choice between a local rule and a generation, its clarifying question when two destinations fit, and its failure fallback's confirmation. `onboard` says what to do at each of those points instead: write the local rule, or skip the candidate and name it beside the report summary. Previously an onboarding agent could read `route` as permission to ask questions that `onboard` forbids.
