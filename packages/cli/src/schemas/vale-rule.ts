/**
 * The structural schema for a Vale style file, pinned to {@link VALE_VERSION}.
 *
 * Vale publishes no JSON Schema. Its repository has no `schemas/` directory,
 * and the machine-readable field knowledge exists only behind the hosted MCP
 * server at `api.vale.sh/mcp`, which is a paid product and unavailable to
 * `verify`. So unlike `ast-grep-rule.ts` — which runs `z.fromJSONSchema()` over
 * an upstream artifact fetched per tag — there is nothing here to fetch.
 *
 * There is, however, a binary that answers questions. Every vocabulary this
 * module enumerates is **derived** from it by `scripts/generate-vale-schema.ts`
 * and lives in `../generated/vale-vocabulary.ts`: check types and levels read
 * out of the error Vale raises when it enumerates its own accepted set, field
 * tables probed key by key, scope operands measured firing on a fixture. This
 * file is the validation layer over that vocabulary, not a second copy of it.
 *
 * The distinction matters because it changes what a Vale bump costs. A
 * transcription drifts silently and is re-authored by hand; a derivation is
 * re-run, and where the answer moved, the artifact's diff says so. What holds
 * both to the binary is unchanged: `test/vale-corpus.ts` is a table of minimal
 * rules, each with a document it must flag, run through the vendored binary and
 * through this module, asserting the two agree.
 *
 * Two directions of error, and they are not symmetric:
 *
 * - **Too lax** — a rule the binary will not honor verifies clean. That is the
 *   gap this module exists to close.
 * - **Too strict** — a rule the binary accepts is rejected. That is worse: it
 *   blocks work that would have functioned. Where a measurement is ambiguous,
 *   accept.
 *
 * That asymmetry is also the honest limit of the generator. Field tables and
 * scope operands are established by *membership*: Vale's `E201` names the key
 * you got wrong and never the ones you could have used, and an unknown scope
 * raises nothing at all. So both are verified rather than discovered, and a
 * real field nobody proposed is absent — the too-strict direction. The
 * generator's candidate list is seeded accordingly, and its provenance is
 * documented there.
 *
 * ## Shape
 *
 * Two stages, in the order the binary itself works:
 *
 * 1. **The header.** Vale reads `extends`, `message` and `level` literally,
 *    before it decodes anything else, and gives up if they are wrong. `scope`
 *    rides along because it is common to all twelve checks and is a grammar
 *    rather than a value. It is also, measured, read literally itself, which is
 *    why the set of literally-read keys is derived rather than assumed to be
 *    the header three.
 * 2. **The check's own fields**, as a `z.discriminatedUnion` on `extends`.
 *    That is Vale's `E201` class expressed as schema shape: a strict object per
 *    check type, so a field belonging to another one is rejected by the union
 *    rather than by hand-written branching.
 *
 * Stage 2 runs only if stage 1 passed, which reproduces the binary: an
 * `extends` it does not recognize is reported on its own, because with no check
 * type there is no field table to check anything against.
 */

import { z } from "zod";

import {
  VALE_CHECK_FIELDS,
  VALE_CHECK_TYPES,
  VALE_COMMON_FIELDS,
  VALE_HEADER_FIELDS,
  VALE_LEVELS,
  VALE_LITERAL_KEYS,
  VALE_PERMISSIVE_CHECKS,
  VALE_SCOPE_OPERANDS as DERIVED_SCOPE_OPERANDS,
  VALE_SCOPE_PREFIXES,
  VALE_VOCABULARY_VERSION,
} from "../generated/vale-vocabulary";
import { VALE_VERSION } from "../rules/capabilities";
import { schemaLayer, type SchemaLayerResult } from "./layer";

export {
  VALE_CHECK_TYPES,
  VALE_LEVELS,
  VALE_PERMISSIVE_CHECKS,
} from "../generated/vale-vocabulary";

/**
 * The Vale release both the vocabulary and the vendored binary refer to.
 *
 * Regenerating the artifact and bumping {@link VALE_VERSION} are two separate
 * edits and nothing sequences them. If they ever disagree, every enum in this
 * module is a measurement of some *other* Vale — which is precisely the drift
 * deriving the vocabulary was meant to end.
 *
 * The conditional type is what settles it. Both sides are string literal types,
 * so the compiler can decide the question: on a mismatch the alias resolves to
 * `never`, the assignment below is rejected, and the build fails naming this
 * line. A runtime `if` would have thrown instead — later, on whichever command
 * happened to load the schema first, in front of a user rather than an author.
 *
 * Every message in this module interpolates this rather than
 * {@link VALE_VERSION}, so the assertion cannot be quietly orphaned.
 */
type PinnedValeVersion =
  typeof VALE_VOCABULARY_VERSION extends typeof VALE_VERSION
    ? typeof VALE_VERSION
    : never;

const PINNED_VALE_VERSION: PinnedValeVersion = VALE_VERSION;

/**
 * The name of one of Vale's twelve check types.
 *
 * The set itself is derived: an unknown `extends` is not silently ignored, so
 * the binary fails the file and enumerates its own accepted values, and the
 * generator reads them back out. That is what settles the eleven-versus-twelve
 * question the docs and Vale's own MCP guide disagree on — the docs' eleven
 * folds `readability` into `metric`, and the binary treats them as separate
 * checks whose fields are disjoint.
 */
export type ValeCheckType = (typeof VALE_CHECK_TYPES)[number];

/**
 * The keys Vale reads literally, before the case-insensitive field decode.
 *
 * Measured, and wider than it looks. `Tokens:` and `ignoreCase:` are read
 * exactly as their lowercase spellings, but `EXTENDS:` fails with "Missing the
 * required 'extends' key" and `Message:` with the same for `message`.
 * `LEVEL: warning` is stranger still: it reaches the field decode as `level`,
 * which the header reader has already removed, so it comes back as
 * `E201 has invalid keys: 'level'`. `Scope:` and `Name:` behave the same way.
 *
 * That last pair is why this is a derived set rather than the three header
 * keys typed out here. `scope` and `name` are ordinary members of every
 * check's field table, so they look like body fields, and lowercasing them
 * would have made `Scope: fenced` validate clean against a rule Vale refuses
 * to load. For `scope` it is worse than an equality of outcomes: the grammar
 * in {@link scopeMessages} is the only thing that ever inspects that value, and
 * a canonicalised `Scope` reaches stage 2 as a plain `z.unknown()` field.
 *
 * {@link canonicalKeys} reproduces the split, which is why these are named as
 * a set.
 */
const LITERAL_KEYS = new Set<string>(VALE_LITERAL_KEYS);

/**
 * The three keys stage 1 gives real types to.
 *
 * A subset of {@link LITERAL_KEYS}, and a different statement: these are the
 * keys Vale needs before it can decode a check at all, so the schema types them
 * rather than leaving them `unknown`. Generated alongside the rest of the
 * vocabulary so this file and the generator read one copy of the fact.
 */
const TYPED_HEADER_KEYS = new Set<string>(VALE_HEADER_FIELDS);

// --- The scope grammar -------------------------------------------------------

/**
 * The `scope` operands the binary was measured honoring.
 *
 * Each was derived by authoring a rule with that scope over a fixture carrying
 * its construct and confirming the finding appeared, with an independent reach
 * probe proving the fixture was linted at all. An operand that never fired is
 * not here, whatever the documentation says about it.
 *
 * This is the highest-value list in the module, because `scope` is the one
 * field nothing downstream ever validates. An unrecognized `extends` fails the
 * run loudly; an unrecognized field raises `E201`. An unrecognized **scope**
 * loads, runs, and matches nothing — no error, anywhere, ever. It is also the
 * list with no oracle: `extends` and `level` enumerate themselves, and this
 * one has to be proposed and then measured, which is why the generator emits
 * `vale-vocabulary-report.md` alongside it. Two entries there are worth
 * knowing: `meta` and `meta.class.<kind>` are documented and never fire, and
 * `frontmatter` / `frontmatter.<key>` fire while being documented nowhere.
 */
const SCOPE_OPERANDS = new Set<string>(DERIVED_SCOPE_OPERANDS);

/**
 * Scope families whose tail is author-supplied and cannot be enumerated.
 *
 * `frontmatter.title` names a key in the document's own front matter;
 * `text.class.callout` names an HTML class. Both were measured firing, and
 * neither has a closed set — rejecting an unfamiliar tail would be the
 * "too strict" failure against a value the binary honors.
 */
const SCOPE_PREFIXES: readonly string[] = VALE_SCOPE_PREFIXES;

/**
 * Operands, for the message `verify` shows an author.
 *
 * The open families are spelled with a placeholder tail rather than omitted:
 * an author told only that `frontmatter.title` is wrong, with no mention of
 * `frontmatter.<name>` in the accepted set, learns the wrong lesson.
 */
export const VALE_SCOPE_OPERANDS: readonly string[] = [
  ...SCOPE_OPERANDS,
  ...SCOPE_PREFIXES.map((prefix) => `${prefix}<name>`),
].toSorted();

function isScopeOperand(operand: string): boolean {
  if (SCOPE_OPERANDS.has(operand)) return true;
  return SCOPE_PREFIXES.some(
    (prefix) => operand.startsWith(prefix) && operand.length > prefix.length
  );
}

const scopeVocabulary =
  `Accepted: ${VALE_SCOPE_OPERANDS.join(", ")} (each optionally prefixed ` +
  `with "~", chained with "&", or given as a list).`;

/**
 * Check one `scope` string, which is a small grammar rather than a value.
 *
 * Measured, the binary accepts a bare operand, a `~` negation, and operands
 * chained with `&` — `~code`, `[~code]`, and `text & ~code` all parse and
 * behave. An enum would reject every one of those, which is worse than the gap
 * it closes, so the enum applies to the *operands* and this walks the operators
 * around them.
 *
 * **A negation over an unrecognized operand is rejected as strictly as a bare
 * one, and that is a deliberate business rule rather than a transcription.**
 * `~fenced` does not fail: it fires on everything, because there is no `fenced`
 * to subtract. The binary "accepts" it in the only sense an exit code can
 * express, and what the author gets is a rule with its exclusion silently
 * deleted — the exact class of failure this module exists to catch.
 * `test/vale-corpus.ts` carries it as a recorded divergence rather than as a
 * row the differential quietly skips.
 */
function scopeMessages(scope: string): string[] {
  const messages: string[] = [];
  for (const part of scope.split("&")) {
    const negated = part.trim().startsWith("~");
    const operand = part.trim().replace(/^~/, "").trim();
    if (operand === "") {
      messages.push(`scope: empty operand in "${scope}".`);
      continue;
    }
    if (isScopeOperand(operand)) continue;
    messages.push(
      negated
        ? `scope: "~${operand}" negates a scope Vale ${PINNED_VALE_VERSION} does ` +
            `not have, so it subtracts nothing and the rule fires everywhere — ` +
            `the exclusion you wrote it for is silently gone. Vale does not ` +
            `report this, so verify does. ${scopeVocabulary}`
        : `scope: "${operand}" is not a Vale ${PINNED_VALE_VERSION} scope. Vale ` +
            `does not reject an unknown scope — the rule loads, runs, and ` +
            `matches nothing. ${scopeVocabulary}`
    );
  }
  return messages;
}

// --- Stage 1: the header -----------------------------------------------------

/**
 * A YAML mapping whose header keys Vale would accept.
 *
 * Everything here is checked against the **raw** keys, before
 * {@link canonicalKeys} lowercases anything, because these are the three keys
 * Vale reads literally.
 */
const valeHeaderSchema = z
  .record(z.string(), z.unknown(), {
    error: "the style file is not a YAML mapping.",
  })
  .check((context) => {
    const rule = context.value;
    const fail = (path: PropertyKey[], message: string): void => {
      context.issues.push({ code: "custom", input: rule, path, message });
    };

    const extendsValue = rule.extends;
    if (typeof extendsValue !== "string") {
      fail(["extends"], "missing the required 'extends' key.");
    } else if (
      !(VALE_CHECK_TYPES as readonly string[]).includes(extendsValue)
    ) {
      fail(
        ["extends"],
        `extends "${extendsValue}" is not a Vale ${PINNED_VALE_VERSION} check type. ` +
          `Vale fails the whole run over this, taking every other Vale rule's ` +
          `findings with it. Accepted: ${VALE_CHECK_TYPES.join(", ")}.`
      );
    }

    if (typeof rule.message !== "string") {
      fail(["message"], "missing the required 'message' key.");
    }

    if (
      rule.level !== undefined &&
      (typeof rule.level !== "string" ||
        !(VALE_LEVELS as readonly string[]).includes(rule.level))
    ) {
      fail(
        ["level"],
        `level ${JSON.stringify(rule.level)} is not one of ` +
          `${VALE_LEVELS.join(", ")}.`
      );
    }

    // `scope` is common to all twelve checks, so it is stated once here rather
    // than repeated across every member of the union below.
    //
    // Read case-sensitively, which is the measured behaviour rather than an
    // oversight. `scope` is one of the keys Vale reads literally, so `Scope:`
    // is not a synonym for it: the binary fails the run with
    // `E201 has invalid keys: 'scope'`. {@link LITERAL_KEYS} keeps that
    // spelling out of canonicalisation, so stage 2's strict object rejects it
    // exactly as Vale does, and the grammar here never has to guess which
    // spelling it is looking at. Lowercasing it instead would be the worst of
    // both: a rule Vale refuses to load would validate clean, having reached
    // stage 2 as a plain `z.unknown()` field with the grammar below skipped.
    const { scope } = rule;
    if (scope === undefined) return;
    if (typeof scope !== "string" && !Array.isArray(scope)) {
      fail(["scope"], "scope must be a string or a list of strings.");
      return;
    }
    const operands = typeof scope === "string" ? [scope] : scope;
    for (const [index, entry] of operands.entries()) {
      if (typeof entry !== "string") {
        fail(
          ["scope", index],
          `scope[${String(index)}] must be a string, not ${typeof entry}.`
        );
        continue;
      }
      for (const message of scopeMessages(entry)) {
        fail(["scope", index], message);
      }
    }
  });

/**
 * Lowercase every field name Vale would lowercase, and no others.
 *
 * Vale decodes a check's own fields through a case-insensitive map, so
 * `Tokens:` and `ignoreCase:` are read exactly as their lowercase spellings and
 * must not be reported as unrecognized. The three header keys are the
 * exception: they are read literally and removed before the field decode, so a
 * differently-cased spelling is left alone here and falls through to the strict
 * object below — which is what Vale does with `LEVEL: warning`, reporting
 * `E201 has invalid keys: 'level'`.
 */
function canonicalKeys(rule: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    const lower = key.toLowerCase();
    canonical[LITERAL_KEYS.has(lower) && key !== lower ? key : lower] = value;
  }
  return canonical;
}

// --- Stage 2: the per-check field tables -------------------------------------

/**
 * Fields every strict check accepts, whatever it extends.
 *
 * Derived as the *intersection* of the twelve measured field tables rather
 * than declared, which is a stronger statement than a hand-written list: no
 * one had to remember that `vocab` does not belong here because five checks
 * reject it — the intersection simply does not contain it.
 *
 * Values are `unknown` throughout. The binary decides what a field's type
 * means, and guessing here would be the "too strict" failure against types
 * nothing measured.
 */
const commonFields: Record<string, z.ZodType> = {
  // The header keys are filtered out rather than left to be overwritten. They
  // are part of the measured intersection, so an unfiltered spread creates all
  // three as `z.unknown()` and the typed entries below survive only because a
  // later key in an object literal wins. That is a real dependency on line
  // order for the typing of `extends`, `message` and `level`, and nothing in
  // the shape of the code says so; filtering makes the override the structure
  // instead of a side effect of it.
  ...Object.fromEntries(
    VALE_COMMON_FIELDS.filter((field) => !TYPED_HEADER_KEYS.has(field)).map(
      (field) => [field, z.unknown()]
    )
  ),
  extends: z.string(),
  message: z.string(),
  level: z.string().optional(),
};

/** The field names above, for the message a rejected field gets. */
const COMMON_FIELD_NAMES = Object.keys(commonFields);

/**
 * One member of the union: the check's own fields, and nothing else.
 *
 * `z.strictObject` is what makes this worth doing — the `E201` class becomes a
 * property of the schema's shape rather than a hand-written key walk. The
 * custom `error` turns zod's "Unrecognized key" into the sentence an author can
 * act on, because the blast radius is the reason the check exists at all.
 */
function check(name: ValeCheckType, fields: readonly string[]) {
  const accepted = [...COMMON_FIELD_NAMES, ...fields].toSorted();
  return z.strictObject(
    {
      ...commonFields,
      extends: z.literal(name),
      ...Object.fromEntries(fields.map((field) => [field, z.unknown()])),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `${issue.keys.map((key) => `'${key}'`).join(", ")} ` +
            `${issue.keys.length === 1 ? "is not a field" : "are not fields"} ` +
            `of the ${name} check. Vale reports this as E201 and reads one ` +
            `config for the whole run, so it suppresses every other Vale ` +
            `rule's findings. ${name} accepts: ${accepted.join(", ")}.`
          : undefined,
    }
  );
}

/**
 * The two checks that validate nothing.
 *
 * Derived by offering every check a sentinel key no check has: `consistency`
 * and `spelling` load without complaint and ignore it. They do not use the
 * strict decode the other ten do, so the binary raises no `E201` for a foreign
 * field there.
 *
 * `z.looseObject` follows the binary rather than the docs. Being strict here
 * would reject rules that work — the "too strict" direction — to catch a typo
 * that costs nothing but a rule quietly missing one of its own fields. The
 * recipe says so in prose, which is the only place it can be said.
 */
function permissiveCheck(name: ValeCheckType) {
  return z.looseObject({ ...commonFields, extends: z.literal(name) });
}

/**
 * The per-check field tables, derived rather than transcribed.
 *
 * Each name here was proposed by the generator's candidate list, added to a
 * minimal working rule of that check, and confirmed by the binary. Three
 * entries contradict Vale's published docs and the binary wins:
 * `capitalization` takes `prefix` **singular** and rejects `prefixes` and
 * `suffixes`; `capitalization` rejects `ignorecase`; `occurrence` rejects
 * `exceptions` and `vocab`. All three names stay in the generator's candidate
 * list precisely so that those stay recorded findings rather than omissions.
 *
 * `consistency` and `spelling` are absent on purpose — see
 * {@link permissiveCheck}.
 */
const CHECK_FIELDS = VALE_CHECK_FIELDS;

/**
 * The `E201` class, as schema shape.
 *
 * Ten strict objects and two loose ones, discriminated on `extends`, so a field
 * belonging to another check type is rejected by the union rather than by a
 * hand-written key walk. The members are spelled out rather than mapped over
 * {@link CHECK_FIELDS} so that each `z.literal` survives into {@link ValeRule}.
 */
/**
 * Field shapes that crash the binary outright.
 *
 * These are not field-table facts, which is why they sit apart from the union:
 * every key involved is a legal field of its check. It is the *shape* that is
 * fatal. Measured against Vale 3.18.0, each of the shapes below ends the
 * process with a Go stack trace. The two `sequence` shapes fail while the rule
 * is compiled:
 *
 * ```
 * panic: interface conversion: interface {} is nil, not []interface {}
 * ```
 *
 * and the `metric` shape fails later, while the rule runs on a document:
 *
 * ```
 * panic: interface conversion: interface {} is float64, not bool
 * ```
 *
 * Either is a wider blast radius than `E201`. An `E201` is at least a
 * diagnostic naming a file and a line; a panic is a stack trace with no rule
 * name in it, no findings for any rule, and nothing an author can act on. This
 * is the last place `verify` can say anything useful at all.
 *
 * It is also the reason a probe must never be trusted to a grep. A panic
 * contains no `has invalid keys` string, so a probe looking for that phrase
 * scores a panicking rule as *accepted* — which is exactly how `sequence` came
 * to look like a check that validates nothing. It is strict; a tokenless
 * `sequence` rule simply never reaches the validation.
 */
function fatalShapeMessages(
  rule: Record<string, unknown>
): { path: PropertyKey[]; message: string }[] {
  const fatal: { path: PropertyKey[]; message: string }[] = [];

  if (rule.extends === "sequence") {
    if (rule.tokens === undefined) {
      fatal.push({
        path: ["tokens"],
        message:
          "a sequence check needs 'tokens'. Without it Vale does not report " +
          "an error — it panics, ending the run with a Go stack trace and no " +
          "findings for any rule in the project.",
      });
    } else if (!Array.isArray(rule.tokens)) {
      fatal.push({
        path: ["tokens"],
        message:
          `a sequence check's 'tokens' must be a list, not ` +
          `${typeof rule.tokens}. Vale panics on any other shape, ending the ` +
          `run with a Go stack trace and no findings for any rule in the ` +
          `project.`,
      });
    }
  }

  if (rule.extends === "metric" && rule.formula !== undefined) {
    // Structural, like the `sequence` arm above, because "was the key
    // supplied" is the wrong question. Measured against 3.18.0, the panic
    // follows the *value*: an absent `condition`, a `condition:` written with
    // no value (YAML parses that to null, which is not `undefined`), and a
    // blank string all reach the same panic. Other types are not this guard's
    // business: `condition: 5`, a list, a map, or a bool fails the decode
    // cleanly with an `E201`, which is a diagnostic an author can read.
    const condition = rule.condition;
    const unusable =
      condition === undefined ||
      condition === null ||
      (typeof condition === "string" && condition.trim() === "");
    if (unusable) {
      fatal.push({
        path: ["condition"],
        message:
          "a metric check with a 'formula' also needs a 'condition' holding " +
          "a comparison, such as '> 1'. An absent, empty, or blank one is " +
          "the same thing to Vale: it panics on a formula it has nothing to " +
          "compare, ending the run with a Go stack trace and no findings for " +
          "any rule in the project.",
      });
    }
  }

  return fatal;
}

/**
 * The union's members, spelled out, and the guard that keeps them honest.
 *
 * They are spelled out rather than mapped over {@link CHECK_FIELDS} because
 * that is what carries each `z.literal` into {@link ValeRule}; a mapped union
 * infers `extends: string` and the type stops saying anything. The cost is
 * that this list is hand-maintained while the vocabulary it draws from is
 * derived, so a Vale release that adds or renames a check type would leave a
 * member missing here, and the schema would reject a rule the binary runs.
 *
 * This block closes that gap at import, and it reads the discriminants off
 * *these members* rather than off a second list of names. A name list would
 * only prove that the list agrees with the vocabulary: a maintainer could
 * satisfy the guard by adding the name and never adding the `check(...)` call,
 * leaving the union a member short while the error that prompted the edit went
 * away. Asking the members themselves means the only way to satisfy the guard
 * is to build the member. Every derived check type must appear here exactly
 * once, and must be classified as either strict or permissive. The failure is
 * then a sentence naming the check, rather than a rule that mysteriously stops
 * verifying six months later.
 */
const UNION_MEMBERS = [
  check("existence", CHECK_FIELDS.existence),
  check("substitution", CHECK_FIELDS.substitution),
  check("capitalization", CHECK_FIELDS.capitalization),
  check("occurrence", CHECK_FIELDS.occurrence),
  check("repetition", CHECK_FIELDS.repetition),
  check("conditional", CHECK_FIELDS.conditional),
  check("metric", CHECK_FIELDS.metric),
  check("readability", CHECK_FIELDS.readability),
  check("sequence", CHECK_FIELDS.sequence),
  check("script", CHECK_FIELDS.script),
  permissiveCheck("consistency"),
  permissiveCheck("spelling"),
] as const;

{
  const discriminants = UNION_MEMBERS.map(
    (member) => member.shape.extends.value
  );
  const spelled = new Set<string>(discriminants);
  const derived = new Set<string>(VALE_CHECK_TYPES);
  const missing = [...derived].filter((name) => !spelled.has(name));
  const extra = [...spelled].filter((name) => !derived.has(name));
  const permissive = new Set<string>(VALE_PERMISSIVE_CHECKS);
  const unclassified = [...derived].filter(
    (name) => !permissive.has(name) && !(name in CHECK_FIELDS)
  );

  if (missing.length > 0) {
    throw new Error(
      `Vale ${PINNED_VALE_VERSION} has a ${missing.join(", ")} check and the schema's ` +
        `union does not, so every rule extending it would be rejected. Add ` +
        `the member in src/schemas/vale-rule.ts.`
    );
  }
  if (extra.length > 0) {
    throw new Error(
      `the schema's union has a ${extra.join(", ")} member and Vale ` +
        `${PINNED_VALE_VERSION} has no such check, so those rules would verify clean ` +
        `and then fail the whole run. Remove the member in ` +
        `src/schemas/vale-rule.ts.`
    );
  }
  if (unclassified.length > 0) {
    throw new Error(
      `${unclassified.join(", ")} is in neither the derived field tables nor ` +
        `the permissive set, so there is nothing to build a union member from. ` +
        `Re-run the generator: pnpm generate:vale-schema.`
    );
  }
  if (spelled.size !== discriminants.length) {
    // "Exactly once" is a real requirement rather than tidiness: zod matches a
    // discriminated union by discriminant, so a second member for a check that
    // already has one is dead code that no rule ever reaches.
    const repeated = [...spelled].filter(
      (name) => discriminants.filter((other) => other === name).length > 1
    );
    throw new Error(
      `the schema's union has more than one ${repeated.join(", ")} ` +
        `member, and only the first is reachable. Remove the duplicate in ` +
        `src/schemas/vale-rule.ts.`
    );
  }
}

const valeBodySchema = z
  .discriminatedUnion(
    "extends",
    UNION_MEMBERS,
    {
      // Unreachable in practice — the header rejects an unknown `extends` first,
      // with a message naming all twelve. Supplied so that if the two ever drift
      // apart the fallback is still a sentence rather than "Invalid input".
      error: () => `extends must be one of: ${VALE_CHECK_TYPES.join(", ")}.`,
    }
    // Runs only once the field tables have passed, which is the right order: a
    // shape can only be fatal if every key in it was legal to begin with.
  )
  .check((context) => {
    const rule = context.value as Record<string, unknown>;
    for (const { path, message } of fatalShapeMessages(rule)) {
      context.issues.push({ code: "custom", input: rule, path, message });
    }
  });

/** A Vale style file, as the schema understands one. */
export type ValeRule = z.infer<typeof valeBodySchema>;

/**
 * The whole rule: header, then the check's own fields.
 *
 * `.pipe` is doing the sequencing — zod runs the second stage only if the first
 * produced no issues, which is exactly the binary's behavior. An `extends` Vale
 * does not know, a missing `message`, or a bad `level` is reported on its own,
 * because none of them leaves a field table to check against.
 */
export const valeRuleSchema = valeHeaderSchema
  .transform(canonicalKeys)
  .pipe(valeBodySchema);

/** What the schema layer concluded. Shared with the ast-grep path. */
export type ValeSchemaResult = SchemaLayerResult;

/**
 * Validate a parsed Vale style file structurally, before Vale is invoked.
 *
 * Every message is already a full sentence naming its own field, so the
 * formatter only has to say which file it is about — unlike the ast-grep path,
 * where the upstream schema's generic messages need their path prepended.
 */
export function validateValeRule(
  ruleId: string,
  data: unknown
): ValeSchemaResult {
  return schemaLayer(
    valeRuleSchema.safeParse(data),
    (issue) => `${ruleId}.yml: ${issue.message}`
  );
}
