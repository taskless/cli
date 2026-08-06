---
"@taskless/cli": minor
---

Add a `@taskless/cli/prompts` subpath export exposing the CLI's knowledge prompts as importable, topic-keyed render functions.

`getPrompt(topic, options?)` and the `PROMPTS` map return fully rendered recipe text, with every `%(KEY)s` placeholder already resolved from values the package holds, so a consumer never handles a template dialect. Topic names are typed as `PromptTopic` and start at `static`, the one recipe a service-side consumer can act on; everything else stays internal until a consumer needs it. `PromptOptions` covers the anonymous variant, a `packageManagerDlx` override, and `header: false` for callers placing the text in an LLM system prompt, where the CLI version in the header would otherwise churn the prompt-cache key on every publish.

The export is sourced from the same embedded recipes and the same render path `taskless help <topic>` serves, so the two surfaces cannot drift, and it carries no CLI runtime, so a Worker can import it without pulling in the command tree.
