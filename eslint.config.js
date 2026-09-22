import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "**/dist/",
      "**/dist-self/",
      "**/*.config.js",
      "**/*.config.ts",
      ".lintstagedrc.js",
      "plugins/",
      "openspec/",
      "**/test/fixtures/",
      // The demonstration rule ships as DATA, not as source. Its `check.ts`
      // is bytes the CLI writes into a user's project, where it runs under
      // `tsx` against a structural contract and imports nothing from this
      // repository — so it is deliberately outside every tsconfig, and
      // type-aware linting has no project to resolve it against.
      "packages/cli/assets/demo-runtime/",
      "tmp/",
      // Worktrees are full checkouts nested inside the repo. Without this, a
      // root `eslint .` lints every worktree's copy of the tree — slow, and it
      // fails on whatever an agent has mid-edit. `.claude/worktrees/` is the
      // harness default and stays listed as a backstop for anything that
      // bypasses the WorktreeCreate hook; both are scoped to `worktrees` rather
      // than all of `.claude/` so anything else we put there is still checked.
      "worktrees/",
      ".claude/worktrees/",
      // Zero-dependency CommonJS workflow scripts (covered by their own
      // node:test suite); the app's TS/ESM-oriented rules don't apply.
      ".github/scripts/",
      // Skill scripts, same shape and same reason: zero-dependency CommonJS
      // with its own node:test suite. Linting the skills we now own outright is
      // worth doing, but it is a separate change — the rules that would apply
      // are not these ones.
      ".agents/skills/*/scripts/",
      // Taskless rule fixtures. A rule's `.tests/` holds inputs written to be
      // flagged, and a rule about source comments needs `.ts` fixtures
      // specifically — Vale picks its comments-only tier by extension. They are
      // not part of any tsconfig, so the type-aware rules fail to parse them.
      // `taskless verify` and `taskless test` are what keep them honest.
      ".taskless/",
      // The demo project. Its source is deliberately wrong — `example.cjs`
      // calls `eval` so a rule has something to find — and its fixtures are
      // prose written to be flagged. Linting it fails on content nobody wrote
      // as source. `example-project.test.ts` is what keeps it honest.
      "example/",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  unicorn.configs["flat/recommended"],
  prettierConfig,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Ban /// <reference /> directives in source files — use `import type` instead.
  // Excludes .d.ts files where triple-slash references are the idiomatic pattern.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": [
        "error",
        { path: "never", types: "never", lib: "never" },
      ],
    },
  },
  // TypeScript-specific rules
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Allow unused parameters prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            env: true,
            args: true,
            utils: true,
          },
        },
      ],
    },
  },
  // Import cycle detection.
  //
  // A circular import leaves one of the modules in the cycle holding
  // `undefined` for whatever it imported, and which module loses depends on
  // which one the graph is entered at first. That makes it a bug that the
  // built CLI and most tests never see: it only fires when something enters
  // the graph at the unlucky module. We hit exactly that — a migration
  // registry that read as `undefined` and failed with
  // `TypeError: migrate is not a function`, visible in two tests by luck.
  // This rule is the check that would have caught it at author time.
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "import-x": importX },
    settings: {
      // Which extensions the plugin will parse when it follows an edge out of
      // the file being linted. This is NOT cosmetic and it is not the same
      // knob as the resolver below: the default is `['.js', '.mjs', '.cjs']`,
      // and a file whose extension is not on this list is dropped by
      // `ExportMap.get` before its imports are ever read. Without `.ts` here
      // the rule resolves our files correctly, walks into them, finds nothing,
      // and reports no cycles — on a tree that provably contains one. A lint
      // run that is green because the rule is inert looks exactly like a lint
      // run that is green because the code is clean, which is why the
      // reintroduced-cycle check in this PR's description exists.
      "import-x/extensions": [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
      ],
      // The plugin's own resolver, configured for TypeScript. It is backed by
      // `unrs-resolver`, a direct dependency of eslint-plugin-import-x, so
      // this needs no separate resolver package. It does need the extension
      // list spelled out: the built-in default is
      // `['.mjs', '.cjs', '.js', '.json', '.node']`, which resolves no `.ts`
      // at all, and our sources import extensionlessly under
      // `moduleResolution: "bundler"`. `.js` stays in the list for the handful
      // of specifiers that carry an explicit extension.
      "import-x/resolver-next": [
        createNodeResolver({
          extensions: [
            ".ts",
            ".tsx",
            ".mts",
            ".cts",
            ".js",
            ".mjs",
            ".cjs",
            ".json",
          ],
        }),
      ],
    },
    rules: {
      // On `import type` edges: the rule ignores them, in both directions —
      // it returns early on an `ImportDeclaration` whose `importKind` is
      // `type` (or whose every specifier is), and it filters
      // `isOnlyImportingTypes` edges out of the graph walk. That is the
      // behavior we want and it is not configurable, so there is no option
      // below for it. It is also correct for us: a type-only edge is erased
      // before the module ever runs, so it cannot produce the `undefined`
      // binding this rule exists to catch, and flagging it would push people
      // toward restructuring real code to satisfy an import that has no
      // runtime existence. `verbatimModuleSyntax: true` in `tsconfig.base.json`
      // is what makes this safe to lean on: it forces a type-only import to be
      // written as `import type`, so the erasure is explicit in the syntax the
      // rule reads rather than something the compiler infers later.
      "import-x/no-cycle": [
        "error",
        {
          // `maxDepth` is deliberately not set. Omitting it means unlimited
          // (the rule reads it as `Number.POSITIVE_INFINITY` unless a number
          // is given), and unlimited is what we want: the cycle we shipped was
          // not a two-module A->B->A, and capping the depth would trade away
          // exactly the cycles that are hard to spot by reading the code,
          // which are the only ones worth spending a lint rule on. It is left
          // out rather than passed as `Infinity` because the rule's schema
          // accepts only an integer or the string "∞" there.
          // Do not traverse into node_modules. A cycle that runs through a
          // published dependency is not ours to break — we cannot edit it, so
          // a report on it is noise we would have to suppress — and walking
          // the dependency graph is where this rule's cost actually goes.
          ignoreExternal: true,
          // Keep the default (false). This would suppress a cycle whenever any
          // edge in it is a dynamic `import()`, on the theory that the deferred
          // evaluation breaks the loop. It does not reliably: a dynamic import
          // awaited during module init is as circular as a static one, and the
          // failure mode is the same `undefined`. We have no cycle that needs
          // the escape hatch, so we do not open it.
          allowUnsafeDynamicCyclicDependency: false,
        },
      ],
    },
  },
  // File naming conventions - enforce kebab-case for all TS/TSX files
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
        },
      ],
      // Disable forced numeric separators - 5000 is more readable than 5_000
      "unicorn/numeric-separators-style": "off",
      // Allow null - needed for standard APIs like JSON.stringify
      "unicorn/no-null": "off",
      // Allow destructured imports for node:path module (e.g., import { resolve } from 'node:path')
      "unicorn/import-style": [
        "error",
        {
          styles: {
            "node:path": {
              default: false, // Don't enforce default import, allow named imports
            },
          },
        },
      ],
    },
  }
);
