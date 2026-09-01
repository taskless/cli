import { readFile, readdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

/**
 * No source file may call a path the API marks deprecated.
 *
 * This exists because the obvious guard does not. The intuition is that moving
 * off a renamed path is the compiler's job — the typed client keys on
 * `paths[...]`, so a stale literal should be a type error. It is not. A
 * deprecated path is still IN the OpenAPI document (that is what deprecation
 * means: still served), so `openapi-typescript` emits it as an ordinary entry
 * and `client.GET("/cli/api/rule/{ruleId}")` type-checks exactly as well as the
 * canonical one. Verified by reverting all four typed call sites to the legacy
 * family: `tsc --noEmit` and `eslint` both passed clean.
 *
 * So nothing at all flagged the two template-string call sites, and nothing
 * flagged the four typed ones either. The renamed family would have kept
 * working, silently, for as long as the service kept serving it — which is the
 * failure mode where the deprecation window expires and the CLI breaks in the
 * field rather than in CI.
 *
 * The check reads the **vendored schema**, never a hardcoded list, so it starts
 * enforcing the next deprecation the day `generate:api` records it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = join(HERE, "..", "src");
const SCHEMA_PATH = join(SOURCE_ROOT, "generated", "api.schema.json");

interface OpenApiDocument {
  paths: Record<string, Record<string, { deprecated?: boolean } | undefined>>;
}

/**
 * The static prefix a path is recognizable by, with template parameters and
 * any trailing sub-resource dropped: `/cli/api/rule/{ruleId}/iterate` becomes
 * `/cli/api/rule`. All four members of a renamed family collapse to one
 * prefix, which is also the only form a template-string call site contains.
 */
function resourcePrefix(path: string): string {
  const brace = path.indexOf("{");
  const prefix = brace === -1 ? path : path.slice(0, brace);
  return prefix.replace(/\/+$/, "");
}

async function typeScriptSources(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    // `generated/` is the schema's own transcript: it necessarily names every
    // path, deprecated ones included, and is not a call site.
    if (entry.isDirectory()) {
      if (entry.name === "generated") continue;
      found.push(...(await typeScriptSources(full)));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("deprecated API paths", () => {
  it("are not referenced by any source file", async () => {
    const document = JSON.parse(
      await readFile(SCHEMA_PATH, "utf8")
    ) as OpenApiDocument;

    const deprecated = new Set<string>();
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const operation of Object.values(operations)) {
        if (operation?.deprecated === true)
          deprecated.add(resourcePrefix(path));
      }
    }

    // A deprecation that no longer exists is not a reason to keep an assertion
    // that can never fail, but it is also not a failure. Assert the guard has
    // something to guard only when the API says it does.
    if (deprecated.size === 0) return;

    const offenders: string[] = [];
    for (const file of await typeScriptSources(SOURCE_ROOT)) {
      const source = await readFile(file, "utf8");
      for (const prefix of deprecated) {
        // The negative lookahead keeps `/cli/api/rule` from matching
        // `/cli/api/rule-hash-vectors`, a live path that merely shares a stem.
        const pattern = new RegExp(
          prefix.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`) +
            String.raw`(?![\w-])`
        );
        if (pattern.test(source)) {
          offenders.push(`${relative(SOURCE_ROOT, file)} references ${prefix}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
