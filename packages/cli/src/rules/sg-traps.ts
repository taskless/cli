import { resolveAstGrepLanguage } from "./capabilities";

/**
 * Notices for the ast-grep authoring traps `create-sg-rule` lists as SILENT:
 * the rule parses, validates, runs and exits zero while missing what its
 * author meant it to match.
 *
 * Notices and never errors. Each shape has a legitimate use — a sibling
 * relation meant to stop at the neighbour, a pattern meant to require at least
 * one argument — and `validate` cannot tell which the author meant. A notice is
 * something they can decide about; an error is something they cannot write
 * past.
 *
 * Decided over the parsed rule object rather than by a second engine pass.
 * Every trap here is a fact about the rule's own structure, so the structure is
 * the place to read it, and it costs no subprocess.
 *
 * A trap ast-grep refuses outright (a keyword named as a `kind`, a Markdown
 * inline construct) is not here: `parseSgRuleAlone` rejects those.
 */
export function findSgTraps(rule: Record<string, unknown>): string[] {
  const notices: string[] = [];
  const language =
    typeof rule.language === "string"
      ? resolveAstGrepLanguage(rule.language)
      : undefined;
  const typescriptFamily = language === "TypeScript" || language === "Tsx";

  for (const key of ["rule", "constraints", "utils"] as const) {
    const container = rule[key];
    if (container === undefined) continue;
    walk(container, key, (node, path) => {
      notices.push(
        ...separatorTraps(node, path),
        ...siblingTraps(node, path),
        ...(typescriptFamily ? calleeTraps(node, path) : [])
      );
    });
  }

  return notices;
}

type Visit = (node: Record<string, unknown>, path: string) => void;

/** Every object in a rule tree, with a dotted path for the message. */
function walk(value: unknown, path: string, visit: Visit): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${String(index)}]`, visit);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  visit(node, path);
  for (const [key, child] of Object.entries(node)) {
    walk(child, `${path}.${key}`, visit);
  }
}

/** A comma directly after a `$$$` metavariable: the leading form. */
const LEADING_ELLIPSIS = /\$\$\$[A-Z0-9_]*\s*,/;
/** A comma directly before a `$$$` metavariable: the trailing form. */
const TRAILING_ELLIPSIS = /,\s*\$\$\$/;

/**
 * `$$$` beside a comma. Under the default `smart` strictness the `,` is a node
 * the target must also have, so `foo($A, $$$)` never matches `foo(1)`.
 *
 * The trailing form is rescued by an object pattern with `strictness: ast`, so
 * one that already declares it is left alone. The leading form is not rescued
 * by anything but alternatives, so it is reported either way.
 */
function separatorTraps(node: Record<string, unknown>, path: string): string[] {
  const pattern = node.pattern;
  let text: string | undefined;
  let astStrict = false;
  if (typeof pattern === "string") {
    text = pattern;
  } else if (
    pattern !== null &&
    typeof pattern === "object" &&
    !Array.isArray(pattern)
  ) {
    const object = pattern as Record<string, unknown>;
    if (typeof object.context === "string") text = object.context;
    astStrict = object.strictness === "ast";
  }
  if (text === undefined) return [];

  if (LEADING_ELLIPSIS.test(text)) {
    return [
      `${path}.pattern \`${text}\` puts \`$$$\` before a \`,\`, so it never matches a call where nothing precedes the last item: the comma is a node the target must also have. \`strictness: ast\` does not rescue this form. Match each arity as its own branch of an \`any\` instead.`,
    ];
  }
  if (TRAILING_ELLIPSIS.test(text) && !astStrict) {
    return [
      `${path}.pattern \`${text}\` puts a \`,\` before \`$$$\`, so under the default \`smart\` strictness it never matches zero trailing items (\`foo($A, $$$)\` misses \`foo(1)\`). Write it as a pattern object with \`context\`, \`selector\` and \`strictness: ast\`, which ignores the separator.`,
    ];
  }
  return [];
}

/**
 * `follows` or `precedes` with no `stopBy`. The default walks only the
 * immediate sibling, and separators are siblings too, so the previous element
 * of `[10, 10]` is the `,` rather than the `10`.
 */
function siblingTraps(node: Record<string, unknown>, path: string): string[] {
  const notices: string[] = [];
  for (const relation of ["follows", "precedes"] as const) {
    const value = node[relation];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    if ("stopBy" in value) continue;
    notices.push(
      `${path}.${relation} declares no \`stopBy\`, so it checks only the immediately adjacent sibling, and punctuation such as \`,\` counts as one: in \`[10, 10]\` the second \`10\` does not follow a number. Add \`stopBy: end\` inside \`${relation}\` unless stopping at the neighbour is what you mean.`
    );
  }
  return notices;
}

/**
 * A callee matched by `regex` under `field: function`, in TypeScript or Tsx,
 * with no branch for the awaited form. The grammar parses
 * `await rpc<Foo>()` as a call OF the await expression, so the callee is an
 * `await_expression` and the regex never sees `rpc`.
 *
 * Any `await_expression` inside the relation counts as handling it, which is
 * how both of the recipe's workarounds (function and method) are written.
 */
function calleeTraps(node: Record<string, unknown>, path: string): string[] {
  if (node.field !== "function") return [];
  if (
    !subtreeHas(node, (key, value) => key === "regex" && value !== undefined)
  ) {
    return [];
  }
  if (
    subtreeHas(
      node,
      (key, value) => key === "kind" && value === "await_expression"
    )
  ) {
    return [];
  }
  return [
    `${path} matches the callee by \`regex\` under \`field: function\`, which misses every awaited generic call: TypeScript parses \`await rpc<Foo>()\` as a call of the \`await_expression\`, so the callee is never \`rpc\`. Add an \`any\` branch with \`kind: await_expression\` that matches the same callee inside it.`,
  ];
}

function subtreeHas(
  value: unknown,
  test: (key: string, value: unknown) => boolean
): boolean {
  if (Array.isArray(value)) return value.some((item) => subtreeHas(item, test));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => test(key, child) || subtreeHas(child, test)
  );
}
