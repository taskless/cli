# Code Style Guide

This document outlines code style conventions for the Twitchdrift codebase.

## Import Patterns

### Prefer Direct Imports Over Barrel Exports

**DO NOT** use barrel exports (re-exporting from `index.ts` files) for internal modules. Import directly from the source file.

```typescript
// ✅ Good - Direct imports
import { checkoutRepository } from "./actions/git";
import { invokeClaudeCLI } from "./actions/invoke-claude";
import { validateAllRules } from "./actions/validation";

// ❌ Bad - Barrel import
import {
  checkoutRepository,
  invokeClaudeCLI,
  validateAllRules,
} from "./actions";
```

**Rationale:**

- Direct imports make it easier to trace where code is defined
- Reduces indirection when debugging or navigating the codebase
- Avoids circular dependency issues that barrel exports can introduce
- Makes tree-shaking more predictable

**Exception:** Third-party packages that use barrel exports as their public API are fine to import from their main entry point.

```typescript
// ✅ Fine - External package API
import { getSandbox } from "@cloudflare/sandbox";
```

### Group and Order Imports

Organize imports in the following order, separated by blank lines:

1. Node.js built-in modules (if any)
2. External packages (npm dependencies)
3. Internal modules (relative imports)

```typescript
// External packages
import { getSandbox } from "@cloudflare/sandbox";

// Internal modules
import { checkoutRepository } from "./actions/git";
import { invokeClaudeCLI } from "./actions/invoke-claude";
import { GeneratorError, GeneratorErrorCode } from "./types";
```

## Type Definitions

### Prefer Library Types Over Custom Definitions

When working with external APIs or libraries, **always prefer using types exported by those libraries** instead of defining your own interfaces. Library types are more complete, stay in sync with API changes, and provide better IDE support.

```typescript
// ✅ Good - Use library types
import type { Octokit } from "@octokit/core";
import type { Endpoints } from "@octokit/types";

type PullRequest =
  Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];
type IssueComment =
  Endpoints["GET /repos/{owner}/{repo}/issues/comments/{comment_id}"]["response"]["data"];

async function fetchPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
) {
  const response = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: prNumber,
    }
  );
  return response.data; // Correctly typed as PullRequest
}

// ❌ Bad - Custom interface duplicating library types
interface GitHubPR {
  title: string;
  body: string | null;
}

interface GitHubComment {
  id: number;
  user: { login: string } | null;
  body: string;
}
```

**Rationale:**

- Library types are generated from OpenAPI specs or source code, so they're always accurate
- Custom types quickly become stale and incomplete
- IDE autocomplete works better with complete library types
- Reduces maintenance burden - library updates automatically fix type issues

**Common library type patterns:**

| Library        | Type Source                 | Example                                                                          |
| -------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Octokit        | `@octokit/types`            | `Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}']['response']['data']` |
| Octokit client | `@octokit/core`             | `import type { Octokit } from '@octokit/core'`                                   |
| Cloudflare     | `@cloudflare/workers-types` | Globals like `Request`, `Response`, `DurableObjectStub`                          |
| Zod            | Infer from schema           | `z.infer<typeof mySchema>`                                                       |

**When custom types are acceptable:**

- The library doesn't export types
- You need a subset/transformation of the original type for your domain model
- You're defining types for your own APIs (not external ones)

### Export Types Referenced by Public API Signatures

**DO NOT** remove `export` from types that are transitively referenced by exported functions, values, or other exported types, even if tools like knip report them as "unused exports." With `declaration: true` in `tsconfig`, TypeScript requires all types in exported signatures to be exported themselves.

Before removing an `export` from a type, check whether any exported function or value references it in its signature (parameters, return types, or fields of other exported types).

```typescript
// ✅ Good - Type is exported because it's used in an exported function's return type
export interface VerifyResult {
  success: boolean;
  schema: LayerResult;
}

export interface LayerResult {
  valid: boolean;
  errors: string[];
}

export async function verifyRule(path: string): Promise<VerifyResult> { ... }

// ❌ Bad - Knip says LayerResult is "unused" so you remove the export
interface LayerResult { ... }  // breaks declaration emit for VerifyResult
```

**Rationale:**

- Knip tracks direct import usage, not transitive type reachability through exported signatures
- Removing these exports causes `declaration: true` to fail with "exported function has or is using private name" errors
- The fix is tedious: each type must be re-exported individually, often across multiple review cycles

## Cross-Worker Durable Object Access

### Use DurableObjectRPC for Cross-Worker DO Calls

When accessing Durable Objects from a different worker (e.g., dashboard accessing storage DOs), use `DurableObjectRPC<T>` from `@taskless/shared/rpc` instead of `DurableObjectStub<T>`.

```typescript
// ✅ Good - DurableObjectRPC for cross-worker access
import type { DurableObjectRPC } from "@taskless/shared/rpc";
import type { GitHubOrganizationDO } from "@taskless/storage";

const orgDoId = env.GITHUB_ORGANIZATION_DO.idFromName(installId);
const orgDO = env.GITHUB_ORGANIZATION_DO.get(
  orgDoId
) as DurableObjectRPC<GitHubOrganizationDO>;

// ❌ Bad - DurableObjectStub doesn't correctly type RPC returns
import type { GitHubOrganizationDO } from "@taskless/storage";

const orgDO = env.GITHUB_ORGANIZATION_DO.get(
  orgDoId
) as DurableObjectStub<GitHubOrganizationDO>;
```

**Rationale:**

- RPC calls across workers are inherently async - all method returns become Promises
- `DurableObjectStub<T>` doesn't correctly infer Promise-wrapped return types for cross-worker bindings
- `DurableObjectRPC<T>` wraps all method returns in `Promise<>` for correct typing

**When to use each:**

| Context                              | Type to Use                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| Calling DO from **same** worker      | `DurableObjectStub<T>` (the default from a `get() operation) |
| Calling DO from **different** worker | `DurableObjectRPC<T>`                                        |

**Import pattern:**

```typescript
// Type imports for cross-worker DO access
import type { DurableObjectRPC } from "@taskless/shared/rpc";
import type { UserDO, GitHubOrganizationDO } from "@taskless/storage";
```

## Testing

### Verify Build Output In The Build, Not By Parsing It

**A failing build is still a valid test of the build.** When an invariant is about a build artifact, enforce it where the artifact is produced. If a bundle must not contain something, the build should refuse to emit it, rather than emitting it and leaving a test to go looking afterwards. An invariant enforced at production time cannot be violated; one enforced afterwards can only be detected.

**DO NOT** reconstruct a fact about generated output by parsing that output.

```typescript
// ✅ Good - the build refuses to emit a violating artifact
// vite.config.ts
import type { Plugin } from "vite";

const ALLOWED = new Set<string>([
  // allowed specifiers here
]);

function forbidHostCapabilities(): Plugin {
    name: "forbid-host-capabilities",
    generateBundle(_options, bundle) {
      const chunk = bundle["prompts.js"];
      if (chunk?.type !== "chunk") return;
      // rollup already resolved the graph — ask it, don't re-derive it
      for (const specifier of [...chunk.imports, ...chunk.dynamicImports]) {
        if (!ALLOWED.has(specifier)) {
          this.error(`prompts.js must not import ${specifier}`);
        }
      }
    },
  };
}

// ❌ Bad - a test regex-scans the built JavaScript to rebuild the import graph
const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(
  (m) => m[1]
);
for (const specifier of specifiers) {
  expect(specifier, `dist/prompts.js graph imports ${specifier}`).toBe(
    "allowed"
  );
}
```

**Tests that _use_ a built artifact are fine.** Importing the built entry and asserting on its behavior, or spawning the built CLI and asserting on its output, are ordinary tests. The rule is not "tests must not touch build output". It is that tests must not re-derive what the build already knew.

```typescript
// ✅ Fine - uses the artifact, asserts on behavior
const { getPrompt } = await import(pathToFileURL(builtEntry).href);
expect(getPrompt("engine-selection")).toBe(sourceRecipe);

// ✅ Fine - spawns the built CLI, asserts on its output
const { stdout } = await execFileAsync("node", [builtCli, "help"]);
expect(stdout).toContain("Usage:");
```

**Do not add a dependency in order to test an assertion.** If a test needs a parser to make sense of an artifact, that is the signal the check is in the wrong place: the generator already has the structured data. Reach for a new devDependency only when several tests need it and nothing in the existing toolchain can answer the question.

**Worked example.** `packages/cli/test/prompts.test.ts` asserted that the built `dist/prompts.js` chunk graph never reaches the CLI entry or a host capability, by regex-scanning the built JavaScript for `from "…"` to reconstruct the import graph. A built chunk embeds every help recipe as a string literal, and the `engine-selection` recipe contains the phrase `a different axis from "which engine"`, so the scan reported `dist/prompts.js graph imports which engine`. Prose was read as an import.

The fixes that did not work, and why:

| Attempt                                                          | Why it was rejected                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter candidates by specifier shape (`/^(?:node:)?[@\w./-]+$/`) | Passed only because that phrase contains a space. Measured against the real bundle the regex yields `["which engine"]` and the filter drops it, but `differs from "static-tier"` is a bare hyphenated name with no whitespace and would have been reported. The guard held by luck of punctuation. |
| Add `es-module-lexer` as a devDependency                         | Parsed the graph correctly, but bought a dependency, and a second major version since vite already pulls 1.7.0 transitively, to serve a single test.                                                                                                                                               |
| Anchor the regex to line-start                                   | Matched the lexer exactly on today's bundles, but required `from` on the same line as `import`. A future bundler that wrapped a long import would silently stop detecting real imports, trading a loud false positive for a quiet false negative in the guard whose entire job is catching a leak. |

The resolution: rollup's `OutputChunk` already exposes `imports` and `dynamicImports`, the exact resolved graph. The check moved into a vite plugin that fails the build, and the test was deleted.

The same reasoning forbids adding a YAML parser to assert on generated config, or an HTML parser to assert on rendered output. In each case the generator knows the answer and the test is guessing at it.

**Rationale:**

- An invariant enforced at production time cannot be violated; one enforced afterwards can only be detected
- Parsing generated text reconstructs information the generator already had, using a weaker tool
- A check that needs a parser is a check in the wrong place; move it to where the structured data lives
- A build that fails is a faster, earlier signal than a test that fails, and it cannot be skipped
- Regexes over generated output are brittle in the worst direction: they break on content that merely resembles code, and they quietly stop matching when the generator's formatting changes

## Code Quality Checks

**IMPORTANT:** After making code changes, you **MUST** run these checks before considering the task complete:

```bash
# Run TypeScript type checking (required for all TypeScript changes)
pnpm typecheck  # Runs typecheck across all packages

# Run linting (required for all code changes)
pnpm lint

# For package-specific checks:
pnpm --filter @taskless/shared typecheck
pnpm --filter @taskless/storage typecheck
pnpm --filter @taskless/generator typecheck
pnpm --filter @taskless/dashboard typecheck
```

If any of these checks fail, you **MUST** fix the issues before marking the task as complete.

### macOS Version Limitations

**WARNING:** On macOS versions below 13.5.0, the following limitations apply:

- **Wrangler type generation may fail** due to esbuild compatibility issues
- **ESLint may report false positives** about "unsafe" TypeScript operations when Cloudflare types cannot be generated
- **Some build tools may not work correctly**

If you encounter these issues on older macOS versions:

1. TypeScript compilation (`tsc --noEmit`) can still validate basic type safety
2. CI/CD in GitHub Actions will catch issues that local development might miss
3. Consider using a DevContainer or upgrading to macOS 13.5.0+ for full compatibility
