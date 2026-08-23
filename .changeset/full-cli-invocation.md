---
"@taskless/cli": minor
---

Name the CLI by its full invocation everywhere an agent is told to run it.

Agent recipes said `taskless agent route` — a binary almost nobody has on `PATH` — in 114 places, `npx @taskless/cli …` in 40 more, and only the second form was rewritten for non-prod builds. A nightly's recipes therefore sent readers to the released package. All of it now renders through one new sprintf variable, `%(TASKLESS_CLI)s`, which resolves to a caller-supplied invocation, else the build's own invocation when that build is not prod, else the agent-fill marker `<taskless-cli>`.

`@taskless/cli/prompts` gains `getInstructions(topic, options?)` and `getRawInstructions(topic, options?)`, both returning `{ text, variables }`. The raw form hands back the unrendered template and the list of variables it contains, so a host that knows its own launcher can render the text itself; `variables` comes from sprintf-js's own parse rather than a regex over the template. `PromptOptions.invocation` is the only way a consumer sets `TASKLESS_CLI` — the render path stays free of `process` so it remains importable from a Worker.

Fixes launcher detection in user-facing error messages. `getCliPrefix()` read only `npm_config_user_agent`, which every pnpm entry point sets, so running the CLI from a `package.json` script told the user to run `pnpm dlx @taskless/cli@latest`. Detection now reads the path the binary was launched from, recognizes npx and `pnpm dlx` only, and answers "unknown" for everything else. The package specifier comes from the build target, so a nightly's error messages name `@taskless/cli-nightly` at its own version.
