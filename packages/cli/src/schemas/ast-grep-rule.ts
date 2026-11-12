import { z } from "zod";
import * as core from "zod/v4/core";

import upstreamSchema from "../generated/ast-grep-rule-schema.json";
import type { RuleConstraintId } from "../rules/constraints";

/**
 * The `$defs` entries in ast-grep's schema that describe a rule object, and so
 * the only places a `regex` can appear. `SerializableRule` is every plain rule
 * (`rule`, `constraints.*`, `utils.*`, `any`/`all` items, `not`, a rule-form
 * `stopBy`, `nthChild.ofRule`, utility arguments, rewriters); `Relation` is the
 * same object with `stopBy` and `field` added (`has`, `inside`, `precedes`,
 * `follows`, a fix's `expandStart`/`expandEnd`).
 */
const RULE_DEFINITIONS: readonly string[] = ["SerializableRule", "Relation"];

/** Our own `$defs` entry, prefixed so an upstream name can never collide. */
const PINS_KIND_DEFINITION = "TasklessPinsKind";

/** The constraint the pairing reports under. See `rules/constraints.ts`. */
export const REGEX_NEEDS_KIND =
  "sg-regex-needs-kind" satisfies RuleConstraintId;

/**
 * What the pairing tells an author to do, shared by the JSON Schema
 * description an editor shows and the message `validate` prints.
 */
export const REGEX_NEEDS_KIND_HINT =
  'Every "regex", at any depth, needs a "kind" beside it: a sibling `kind:`, ' +
  "or a sibling `any:` whose every branch sets `kind:` (or an `all:` with a " +
  "branch that does). Without one the regex is tested against the text of " +
  "every node, which is ambiguous and slow. To find the kind, run ast-grep " +
  "with `--debug-query=ast` on a sample of the code and take the named node " +
  "the regex should match; under `constraints`, that is the node the " +
  "metavariable captures.";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ast-grep's rule schema with the regex/kind pairing written into it.
 *
 * The upstream schema is vendored verbatim (`scripts/fetch-ast-grep-schema.ts`
 * overwrites it on every upgrade), so the pairing is layered on here rather
 * than edited into the generated file. Every rule-object definition gains
 * `if: { required: [regex] }, then: TasklessPinsKind`, and `TasklessPinsKind`
 * is the one statement of what anchors a regex:
 *
 * - a `kind` in the same object, or
 * - an `any` whose every branch pins a kind, since whichever branch matched,
 *   the node has one of those kinds, or
 * - an `all` with at least one branch that pins a kind, since every branch
 *   matched.
 *
 * `if`/`then` rather than 2020-12's `dependentSchemas`: both say the same
 * thing, and `if`/`then` is the one YAML and JSON language servers have
 * supported longest.
 *
 * zod cannot consume either keyword (`z.fromJSONSchema` throws on both), so
 * {@link astGrepRuleSchema} is built from the upstream schema and mirrors this
 * with a refinement. {@link findRegexWithoutKind} walks the data against this
 * same schema, so the two report the same paths by construction.
 */
function withRegexNeedsKind(schema: JsonObject): JsonObject {
  const augmented = structuredClone(schema);
  const definitions = augmented.$defs;
  if (!isObject(definitions)) {
    throw new Error("ast-grep rule schema has no $defs");
  }
  for (const name of RULE_DEFINITIONS) {
    const definition = definitions[name];
    // A vendor upgrade that renames either definition, or starts using
    // `if`/`then` itself, must fail loudly here rather than ship a schema
    // that silently stopped saying this.
    if (!isObject(definition)) {
      throw new Error(`ast-grep rule schema has no $defs.${name}`);
    }
    if ("if" in definition || "then" in definition) {
      throw new Error(`ast-grep rule schema already uses if/then on ${name}`);
    }
    definition.if = { required: ["regex"] };
    // A JSON Schema keyword on a plain data object, never awaited.
    // eslint-disable-next-line unicorn/no-thenable
    definition.then = { $ref: `#/$defs/${PINS_KIND_DEFINITION}` };
  }
  definitions[PINS_KIND_DEFINITION] = {
    description: `Taskless (${REGEX_NEEDS_KIND}): ${REGEX_NEEDS_KIND_HINT}`,
    anyOf: [
      { required: ["kind"] },
      {
        required: ["any"],
        properties: {
          any: {
            type: "array",
            minItems: 1,
            items: { $ref: `#/$defs/${PINS_KIND_DEFINITION}` },
          },
        },
      },
      {
        required: ["all"],
        properties: {
          all: {
            type: "array",
            contains: { $ref: `#/$defs/${PINS_KIND_DEFINITION}` },
          },
        },
      },
    ],
  };
  return augmented;
}

/**
 * ast-grep's rule JSON Schema, plus the Taskless regex/kind pairing.
 *
 * This is the schema to hand anything schema-aware: an editor, or an agent
 * reading `getSchemaPayload()`'s `astGrepSchema`. It flags a `regex` without
 * a kind at exactly the paths `validate` refuses.
 */
export const astGrepRuleJsonSchema = withRegexNeedsKind(
  upstreamSchema as JsonObject
);

/**
 * Whether a rule object fixes the kind of the node it matches, by the
 * definition in `TasklessPinsKind` above.
 */
function pinsKind(rule: JsonObject): boolean {
  if ("kind" in rule) return true;
  const { any, all } = rule;
  if (
    Array.isArray(any) &&
    any.length > 0 &&
    any.every((branch) => isObject(branch) && pinsKind(branch))
  ) {
    return true;
  }
  return (
    Array.isArray(all) &&
    all.some((branch) => isObject(branch) && pinsKind(branch))
  );
}

export interface RegexWithoutKind {
  /** Where the offending rule object sits, as zod reports paths. */
  path: (string | number)[];
  message: string;
}

const DEFINITION_PREFIX = "#/$defs/";

/**
 * Visit `value` against `schema`, reporting every rule object that uses
 * `regex` without pinning a kind.
 *
 * Schema-directed rather than a hand-listed set of keys, so it reaches every
 * position ast-grep's schema allows a rule (including `stopBy`, `nthChild`'s
 * `ofRule`, utility arguments, a fix's `expandStart`/`expandEnd`, and
 * rewriters) and cannot drift from the JSON Schema an editor applies.
 */
function visit(
  definitions: JsonObject,
  schema: unknown,
  value: unknown,
  path: (string | number)[],
  found: Map<string, RegexWithoutKind>
): void {
  if (!isObject(schema)) return;

  let node = schema;
  const reference = schema.$ref;
  if (
    typeof reference === "string" &&
    reference.startsWith(DEFINITION_PREFIX)
  ) {
    const name = reference.slice(DEFINITION_PREFIX.length);
    const resolved = definitions[name];
    if (!isObject(resolved)) return;
    node = resolved;
    if (
      RULE_DEFINITIONS.includes(name) &&
      isObject(value) &&
      "regex" in value &&
      !pinsKind(value)
    ) {
      // Keyed by path: an `anyOf` can reach the same object twice.
      found.set(JSON.stringify(path), { path, message: REGEX_NEEDS_KIND_HINT });
    }
  }

  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        visit(definitions, branch, value, path, found);
      }
    }
  }

  if (isObject(value)) {
    const properties = isObject(node.properties) ? node.properties : {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema =
        key in properties ? properties[key] : node.additionalProperties;
      visit(definitions, childSchema, child, [...path, key], found);
    }
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      visit(definitions, node.items, item, [...path, index], found);
    }
  }
}

/**
 * Every rule object in a parsed ast-grep rule file that uses `regex` without
 * a kind to anchor it: in `rule`, `constraints`, `utils`, and every composite
 * and relational sub-rule beneath them, at any depth.
 */
export function findRegexWithoutKind(ruleFile: unknown): RegexWithoutKind[] {
  const found = new Map<string, RegexWithoutKind>();
  visit(
    astGrepRuleJsonSchema.$defs as JsonObject,
    astGrepRuleJsonSchema,
    ruleFile,
    [],
    found
  );
  return [...found.values()];
}

/**
 * The zod half of the regex/kind pairing: one issue per path
 * {@link findRegexWithoutKind} reports, each carrying `params.constraintId`
 * so `validate` can attribute it to `sg-regex-needs-kind` without matching on
 * wording.
 *
 * Built with `when: () => true` because a plain `.superRefine()` is skipped
 * whenever the base schema already failed: a rule with a mistyped `severity`
 * would hide its regex problem until the next round, which is the round this
 * check exists to save.
 */
const regexNeedsKindCheck = core._check<unknown>(
  (payload) => {
    for (const { path, message } of findRegexWithoutKind(payload.value)) {
      payload.issues.push({
        code: "custom",
        path,
        message,
        input: payload.value,
        params: { constraintId: REGEX_NEEDS_KIND },
      });
    }
  },
  { when: () => true }
);

/**
 * Zod schema for ast-grep rule validation, derived from the official
 * ast-grep JSON Schema via `z.fromJSONSchema()`, plus the check that mirrors
 * the regex/kind pairing {@link astGrepRuleJsonSchema} adds. zod cannot read
 * the `if`/`then` that states it there, so the upstream schema is the base.
 */
export const astGrepRuleSchema = z
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
  .fromJSONSchema(upstreamSchema as any)
  .check(regexNeedsKindCheck);

/**
 * Taskless-specific required fields, beyond what ast-grep requires.
 * ast-grep only requires `rule` + `language`; Taskless also requires
 * `id`, `severity`, and `message` for meaningful rule output.
 */
export const TASKLESS_REQUIRED_FIELDS = [
  "id",
  "language",
  "severity",
  "message",
  "rule",
] as const;
