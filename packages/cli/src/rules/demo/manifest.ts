/**
 * The demonstration rule's identity and file list, with no imports at all.
 *
 * Separate from `rule.ts` because that module embeds the file CONTENTS through
 * vite's `?raw`, which only resolves under a vite transform. A plain Node
 * script — the reference-payload generator — cannot import it, and neither can
 * anything else outside the bundle.
 *
 * The paths therefore live here, stated once. `rule.ts` embeds exactly this
 * list, the generator reads exactly this list off disk, and
 * `test/demo-reference.test.ts` asserts the two agree — so the shipped rule and
 * the payload we hand the generator team cannot come to describe different
 * things.
 */

/**
 * The rule's directory name, and the id `check` and `test` address it by.
 *
 * Fixed, with no batch suffix. A generated rule carries one so a regeneration
 * does not collide with what is already there; this rule is written from
 * constant bytes, so writing it twice would be the same rule.
 */
export const DEMO_RUNTIME_RULE_ID = "env-keys-declared";

/**
 * Every file the rule directory contains, relative to it.
 *
 * Listed rather than globbed. Three of the six are dot-paths — two under
 * `.tests/` and one named `.env` — and glob helpers skip those by default, so
 * a glob would embed the check and the capture rule and silently omit every
 * fixture. That produces a rule that writes, verifies, and has nothing to
 * prove, which is the exact failure this tier's runner exists to catch.
 */
export const DEMO_RUNTIME_PATHS = [
  "check.ts",
  "captures/env-read.yml",
  ".tests/pass/declared/src/config.ts",
  ".tests/pass/declared/.env",
  ".tests/fail/undeclared/src/config.ts",
  ".tests/fail/undeclared/.env",
] as const;
