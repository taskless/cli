/**
 * The rule layout table — the single description of what a rule is made of and
 * where its files go, for every engine.
 *
 * SPLIT OUT OF `engines.ts` SO IT CAN BE PUBLISHED. This module holds data and
 * nothing else: no filesystem, no network, no command tree. `engines.ts` keeps
 * the helpers that join these values to a `cwd`, because those import
 * `node:fs/promises` and a Worker cannot load them.
 *
 * The split exists because the Cloud Generator builds rule payloads against
 * this table. While it lived only in prose, the same layout was described in
 * seven stale code comments and in `cli-runtime-rule-execution`'s own spec text,
 * all naming a path two migrations had already moved — and one of those stale
 * comments put the wrong layout into a cross-team design document. A shape
 * described in prose drifts in every place it is described, including the one
 * that is supposed to be authoritative. Published as data, it cannot.
 *
 * Re-exported for consumers as `@taskless/cli/layout` (see `src/layout/`).
 */

/**
 * Engines this CLI knows. The directory name under `.taskless/rules/` **is**
 * the engine: dispatch reads the path and never parses a rule file to decide
 * who owns it.
 */
export const ENGINES = ["sg", "vale", "runtime"] as const;

export type EngineName = (typeof ENGINES)[number];

/** How a rule reaches execution, or `null` when this CLI has no executor yet. */
export type EngineExecutor =
  | "ast-grep"
  | "vale-runner"
  | "runtime-harness"
  | null;

export interface EngineLayout {
  engine: EngineName;
  /**
   * The file inside a rule directory that *is* the rule, as a function of the
   * rule id. `sg` and `vale` name it after the rule; `runtime` always calls it
   * `check.ts`, because the rule is a program rather than a document.
   */
  ruleFile: (ruleId: string) => string;
  /**
   * The engine's per-rule config file, or `undefined` where the engine has
   * nothing to put in one.
   *
   * Only Vale has one, and not for symmetry: Vale cannot express a rule's scope
   * inside the style file — measured, it rejects unknown keys with `E201` — so
   * scope needs somewhere else to live. ast-grep carries `files`/`ignores`
   * inside the rule itself, so an `sg` per-rule config would be a file every
   * author creates, no author fills, and every reader learns to ignore.
   */
  ruleConfigFile: string | undefined;
  /** Subdirectory holding ast-grep capture rules, for engines that use them. */
  capturesDirectory: string | undefined;
  executor: EngineExecutor;
}

/**
 * Everything defining a rule lives in one directory,
 * `.taskless/rules/<engine>/<id>/`, the same shape for every engine. A rule is
 * therefore one path — which is what lets `verify` and `test` take a path
 * instead of an id, and what makes deleting a rule an `rm -rf` of one thing.
 */
export const RULES_DIRECTORY = "rules";

/**
 * A rule's tests, relative to its rule directory. **The dot is load-bearing.**
 *
 * ast-grep's `ruleDirs` recurses and parses every `.yml` beneath it as a rule,
 * so a plain `tests/` directory inside a rule directory fails the entire scan
 * with `Fail to parse yaml as RuleConfig: missing field 'language'`. Measured
 * against ast-grep 0.41.0: `tests/` and `__tests__/` both hard-fail,
 * a dot-directory is skipped by rule discovery, and `sg test` still reads it
 * when `testDir` names it.
 *
 * That is undocumented behavior, and three things make depending on it
 * acceptable. The failure is loud — a parse error naming the file, never a test
 * silently reinterpreted as a rule. `ast-grep-vendor-contract.test.ts` pins it
 * alongside the rest of ast-grep's observed behavior, so it is
 * checked on every run rather than remembered. And the binary is pinned to an
 * exact version, so it cannot change without a deliberate bump, which is
 * exactly where that test fires.
 *
 * If it ever does break, the recorded fallback is to materialize a rules-only
 * tree for ast-grep and point `ruleDirs` at that (design D2).
 */
export const RULE_TESTS_DIRECTORY = ".tests";

export const ENGINE_LAYOUTS = {
  sg: {
    engine: "sg",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: undefined,
    capturesDirectory: undefined,
    executor: "ast-grep",
  },
  vale: {
    engine: "vale",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: ".vale.ini",
    capturesDirectory: undefined,
    executor: "vale-runner",
  },
  runtime: {
    engine: "runtime",
    ruleFile: () => "check.ts",
    ruleConfigFile: undefined,
    // `captures/` rather than `matchers/`: "matcher" denotes a Vale `[<glob>]`
    // config section elsewhere in this tree, and one word for two unrelated
    // concepts is a cost paid at every future reading.
    capturesDirectory: "captures",
    executor: "runtime-harness",
  },
} satisfies Record<EngineName, EngineLayout>;

/** Whether `value` names an engine this CLI knows. */
export function isKnownEngine(value: string): value is EngineName {
  return (ENGINES as readonly string[]).includes(value);
}
