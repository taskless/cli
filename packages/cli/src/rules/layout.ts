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

/**
 * How a rule's fixtures group into cases.
 *
 * One value, for every engine: a case is a directory under `tests/pass/` or
 * `tests/fail/`, and the engine's own check is run with that directory as its
 * root. It used to be three values (`runtime` read case directories, `vale`
 * read loose documents, `sg` read ast-grep's `valid:`/`invalid:` test YAML),
 * and each was judged by a different mechanism, none of which was the one
 * `check` runs. A rule whose scope never matched a real file passed its
 * fixtures and reported nothing in `check`.
 *
 * Kept as a type, and published per engine, though it has one member: a
 * consumer asserts on `fixtureLayout`, and it is what a later layout change
 * would move.
 */
export type FixtureLayout =
  /** A case is a directory under `pass/` or `fail/`, handed to the check as its root. */
  "case-directories";

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
  /** How this engine's fixtures group into cases. See {@link FixtureLayout}. */
  fixtureLayout: FixtureLayout;
  executor: EngineExecutor;
}

/**
 * Everything defining a rule lives in one directory,
 * `.taskless/rules/<engine>/<id>/`, the same shape for every engine. A rule is
 * therefore one path — which is what lets `validate` and `verify` take a path
 * instead of an id, and what makes deleting a rule an `rm -rf` of one thing.
 */
export const RULES_DIRECTORY = "rules";

/**
 * The directory the whole tree hangs off, relative to the project root.
 *
 * Here rather than beside its callers because the conformance corpus publishes
 * `.taskless/rules/<engine>/<id>/` as a path a consumer can act on, and a
 * published path needs one value to be generated from.
 *
 * It is not yet the only copy. The literal appears in about fifteen places
 * behind four constants that do not know about each other — `CANONICAL_DIR` in
 * `install/install.ts` and `install/canonical.ts`, `TASKLESS_DIR` in
 * `install/state.ts`, `TASKLESS_DIRECTORY` in `rules/scan.ts` and
 * `rules/vale/formats.ts`. `rulesRoot` reads this one, so what the corpus
 * publishes is what the rule commands resolve. Converging the rest is a
 * tidy-up, and doing it inside a contract change would hide the contract
 * change inside a rename.
 */
export const TASKLESS_DIRECTORY = ".taskless";

/**
 * A rule's tests, relative to its rule directory: `tests/pass/<case>/` and
 * `tests/fail/<case>/`.
 *
 * No dot. The dot used to be load-bearing: ast-grep's `ruleDirs` recurses and
 * parses every `.yml` beneath it as a rule, so a plain `tests/` inside a rule
 * directory fails the whole scan (re-measured on 0.51.0, it still does). The
 * engine is no longer pointed at the committed tree at all. It reads a
 * rules-only copy assembled per run (see `assembleSgConfig`), so what a rule
 * directory may contain stops depending on undocumented discovery behavior,
 * and fixtures sit where an author or an agent looks first.
 */
export const RULE_TESTS_DIRECTORY = "tests";

/**
 * Where fixtures lived before migration `12`, relative to a rule directory.
 *
 * Still read in three places, each for its own reason: the migrations that
 * ran before `12` (`5`, `9`, `10`) wrote here and must keep doing so; delivery
 * reads a served set in this layout and migrates it on write, because the
 * service is not required to move; and reconcile never signs or reports a
 * file under it, because migration `12` leaves behind what it cannot convert.
 */
export const LEGACY_RULE_TESTS_DIRECTORY = ".tests";

export const ENGINE_LAYOUTS = {
  sg: {
    engine: "sg",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: undefined,
    capturesDirectory: undefined,
    fixtureLayout: "case-directories",
    executor: "ast-grep",
  },
  vale: {
    engine: "vale",
    ruleFile: (ruleId: string) => `${ruleId}.yml`,
    ruleConfigFile: ".vale.ini",
    capturesDirectory: undefined,
    fixtureLayout: "case-directories",
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
    fixtureLayout: "case-directories",
    executor: "runtime-harness",
  },
} satisfies Record<EngineName, EngineLayout>;

/** Whether `value` names an engine this CLI knows. */
export function isKnownEngine(value: string): value is EngineName {
  return (ENGINES as readonly string[]).includes(value);
}
