/**
 * Curated annotated examples for `rule verify --schema` output.
 * These teach agents how to write valid ast-grep rules.
 */
export const RULE_EXAMPLES = [
  {
    description:
      "Simple pattern match — detect eval() usage. Uses `any` to match multiple call forms. `$$$` is the wildcard for any number of arguments.",
    rule: {
      id: "no-eval",
      language: "typescript",
      severity: "error",
      message: "Do not use eval() or Function() to evaluate strings as code.",
      note: "Use safer alternatives like JSON.parse() for data.",
      rule: {
        any: [
          { pattern: "eval($$$)" },
          { pattern: "Function($$$)" },
          { pattern: "new Function($$$)" },
        ],
      },
    },
  },
  {
    description:
      "Regex with required kind — detect console.log calls. When using `regex`, you MUST also specify `kind` at the same level. `kind` constrains which AST node type the regex applies to.",
    rule: {
      id: "no-console-log",
      language: "typescript",
      severity: "warning",
      message: "Avoid console.log in production code.",
      note: "Use a proper logging library instead.",
      rule: {
        kind: "call_expression",
        regex: String.raw`^console\.log$`,
      },
    },
  },
  {
    description:
      "Composite rule with all/has — detect unsafe innerHTML assignment. `all` requires every sub-rule to match simultaneously. `has` checks that a matching node contains a child matching another pattern. Use `all` to combine multiple constraints on the same node.",
    rule: {
      id: "no-inner-html",
      language: "typescript",
      severity: "error",
      message: "Do not assign to innerHTML. This can lead to XSS attacks.",
      note: "Use textContent for text or a sanitization library for HTML.",
      rule: {
        all: [
          { pattern: "$EL.innerHTML = $VALUE" },
          {
            not: {
              inside: {
                kind: "call_expression",
                pattern: "DOMPurify.sanitize($$$)",
              },
            },
          },
        ],
      },
    },
  },
  {
    description:
      'Object pattern with `strictness: ast` — detect fetch() with any trailing arguments. A `$$$` next to a comma does NOT mean "zero or more": the comma is itself a node, and under the default `smart` strictness every node in the pattern must match, so `fetch($URL, $$$REST)` skips `fetch(url)` entirely and matches only calls with two or more arguments. Write the pattern as an object with `strictness: ast` to compare named AST nodes and ignore the separator. `strictness` is only valid inside a pattern object — at rule level ast-grep rejects it as an unknown field — and an object pattern also needs `context` plus `selector`. A leading `$$$` (`fetch($$$REST, $LAST)`) is the mirror case and `strictness: ast` does not rescue it; use `any` with one branch per arity instead. A standalone `$$$` with no comma beside it already matches zero arguments and needs none of this.',
    rule: {
      id: "no-bare-fetch",
      language: "typescript",
      severity: "warning",
      message: "Pass explicit options to fetch().",
      note: "Set a timeout and headers rather than relying on the defaults.",
      rule: {
        pattern: {
          context: "fetch($URL, $$$REST)",
          selector: "call_expression",
          strictness: "ast",
        },
      },
    },
  },
];
