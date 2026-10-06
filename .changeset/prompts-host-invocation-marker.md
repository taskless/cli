---
"@taskless/cli": patch
---

`@taskless/cli/prompts` now renders the `<taskless-cli>` marker when the caller passes no `invocation`, on every build. A nightly used to substitute its own `npx @taskless/cli-nightly@<version>` into the recipe body, so `getPrompt(topic, { header: false })` still carried a CLI version and the rendered text changed on every nightly. Pass `invocation` to name a launcher of your own. `taskless agent <topic>` is unchanged and still names the build it was run from.

`mechanics: false` now also covers the passages that name a recipe as a command to fetch. In `route`, the final step names the destination by its topic name (`create-vale-rule`) rather than by its fetch command, and the failure fallback and `See Also` cite topic names, so the render carries no CLI invocation at all. The default rendering is unchanged.
