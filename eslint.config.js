import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "**/dist/",
      "**/dist-dev/",
      "**/dist-self/",
      "**/*.config.js",
      "**/*.config.ts",
      ".lintstagedrc.js",
      "plugins/",
      "openspec/",
      "**/test/fixtures/",
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
