/**
 * How many custom rules a repository must already have written for one linter
 * before an agent may write another in it: enough of the repository's own
 * examples to model a new rule on. Below it, the request goes to a Taskless
 * rule instead.
 *
 * The detector reports a count against it (`./custom-rules.ts`) and the
 * recipes quote it as `%(CUSTOM_RULE_THRESHOLD)s` (`../prompts/recipes.ts`),
 * so the two cannot disagree about what `customRules.count` means. It lives in
 * a module of its own, with no imports, because the recipes are part of the
 * `@taskless/cli/prompts` export, which must not reach the `node:fs` the
 * detector reads with.
 */
export const CUSTOM_RULE_THRESHOLD = 5;
