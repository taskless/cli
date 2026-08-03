/**
 * Where migration `0004` puts the ast-grep tree, relative to `.taskless/`.
 *
 * `0004` runs before anything reads rules (every entry point goes through
 * `ensureTasklessDirectory`), so by the time these are used the flat
 * pre-migration `rules/` and `rule-tests/` no longer exist. Reading the old
 * paths would silently find nothing — an empty scan reports success, so the
 * failure mode is "no findings," not an error.
 */
export const SG_RULES_DIRECTORY = "sg/rules";
export const SG_RULE_TESTS_DIRECTORY = "sg/rule-tests";

/** Where `0004` puts the runtime tree, relative to `.taskless/`. */
export const RUNTIME_RULES_DIRECTORY = "runtime/rules";
export const RUNTIME_RULE_TESTS_DIRECTORY = "runtime/rule-tests";
