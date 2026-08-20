import { builtinModules } from "node:module";
import { chmodSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import type { Plugin, Rollup } from "vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { SKILL_CATALOG } from "./src/install/catalog";
import {
  OUT_DIRS,
  resolveBuildTarget,
  resolveCliInvocation,
  resolveCliNotice,
  resolveOutputDirectory,
} from "./scripts/build-target";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")
) as { version: string };

// Target resolution lives in ./scripts/build-target.ts so it can be unit-tested
// (test/build-target.test.ts) over an explicit environment. Everything below
// binds those pure functions to this process and this package directory.
const buildTarget = resolveBuildTarget(process.env);
const outDir = resolveOutputDirectory(process.env);
const cliInvocation = resolveCliInvocation(process.env, import.meta.dirname);
const cliNotice = resolveCliNotice(process.env, import.meta.dirname);

// A nightly emits to `dist` — the same directory as prod, because that is what
// the tarball carries (see OUT_DIRS). Say so at the call site rather than
// leaving it to be discovered when `pnpm cli` starts naming a nightly.
if (buildTarget === "nightly") {
  console.warn(
    `[taskless] nightly build (${cliInvocation}) — emitting to ${OUT_DIRS.nightly}/, ` +
      `overwriting any prod build there. Run "pnpm --filter @taskless/cli build" to restore it.`
  );
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function assertSkillVersions(): Plugin {
  return {
    name: "assert-skill-versions",
    buildStart() {
      const skillsDir = resolve(import.meta.dirname, "../../skills");
      const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
        d.isDirectory()
      );
      const mismatched: string[] = [];
      const sourceNames = new Set<string>();

      for (const dir of dirs) {
        sourceNames.add(dir.name);
        const skillPath = join(skillsDir, dir.name, "SKILL.md");
        let content: string;
        try {
          content = readFileSync(skillPath, "utf8");
        } catch {
          continue;
        }
        const match = FRONTMATTER_REGEX.exec(content);
        if (!match) continue;
        const data = (parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
        const metadata = (data.metadata ?? {}) as Record<string, string>;
        if (metadata.version !== pkg.version) {
          mismatched.push(
            `${dir.name}: ${metadata.version ?? "(none)"} (expected ${pkg.version})`
          );
        }
      }

      if (mismatched.length > 0) {
        throw new Error(
          `Skill version mismatch! Run "tsx scripts/sync-skill-versions.ts" to fix.\n${mismatched.join("\n")}`
        );
      }

      const catalogNames = new Set(SKILL_CATALOG.map((s) => s.name));
      const missingFromCatalog = [...sourceNames].filter(
        (n) => !catalogNames.has(n)
      );
      const missingFromSource = [...catalogNames].filter(
        (n) => !sourceNames.has(n)
      );

      if (missingFromCatalog.length > 0 || missingFromSource.length > 0) {
        const lines: string[] = [];
        if (missingFromCatalog.length > 0) {
          lines.push(
            `Skills present under skills/ but missing from SKILL_CATALOG in src/install/catalog.ts:`
          );
          for (const name of missingFromCatalog) lines.push(`  - ${name}`);
        }
        if (missingFromSource.length > 0) {
          lines.push(
            `Skills declared in SKILL_CATALOG but missing a source directory under skills/:`
          );
          for (const name of missingFromSource) lines.push(`  - ${name}`);
        }
        throw new Error(lines.join("\n"));
      }
    },
  };
}

// The build emits two entries. `index` is the executable CLI; `prompts` is a
// library module consumers import as `@taskless/cli/prompts`. Only the former
// is a program, so only the former gets a shebang and the executable bit — a
// `#!` line on the library entry would be a syntax error to anything importing
// it as a module.
const BIN_ENTRY = "index";
const PROMPTS_ENTRY = "prompts";

function shebang(): Plugin {
  // Typed against Rollup's own bundle union rather than a structural shape, so
  // an asset cannot satisfy the parameter by having none of these fields. The
  // predicate return lets both hooks narrow to the chunk they act on.
  const isBinEntry = (
    chunk: Rollup.OutputAsset | Rollup.OutputChunk
  ): chunk is Rollup.OutputChunk =>
    chunk.type === "chunk" && chunk.isEntry && chunk.name === BIN_ENTRY;

  return {
    name: "shebang",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (isBinEntry(chunk)) {
          chunk.code = "#!/usr/bin/env node\n" + chunk.code;
        }
      }
    },
    writeBundle(options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (isBinEntry(chunk)) {
          const outPath = resolve(options.dir ?? outDir, fileName);
          chmodSync(outPath, 0o755);
        }
      }
    },
  };
}

/** The entry chunk this build emitted under `name`, if it emitted one. */
function findEntryChunk(
  bundle: Rollup.OutputBundle,
  name: string
): Rollup.OutputChunk | undefined {
  return Object.values(bundle).find(
    (chunk): chunk is Rollup.OutputChunk =>
      chunk.type === "chunk" && chunk.isEntry && chunk.name === name
  );
}

/**
 * Refuse to emit a prompts entry that drags the CLI runtime along with it.
 *
 * `@taskless/cli/prompts` is a library surface: an agent imports it to render
 * recipe text, and it must not pull in the command layer or reach a host
 * capability to do that. The graph is allowed to touch embedded text and the
 * pure helpers it renders with, and nothing else.
 *
 * Two rules, both checked over the entry's transitive chunk graph:
 *
 * - **No external imports at all.** Everything but node builtins is bundled
 *   (see `rollupOptions.external`), so a bare specifier surviving here is a
 *   builtin — `node:fs`, `node:child_process` — and the render path has no
 *   business with any of them.
 * - **Never reach the bin entry.** That chunk is the CLI itself.
 *
 * ENFORCED IN THE BUILD, DELIBERATELY, rather than asserted by a test over the
 * artifact. A build that refuses to emit a leaking bundle makes the bad artifact
 * unproducible; a test that inspects one afterwards only notices. It is also
 * the difference between reading rollup's own resolved graph and reconstructing
 * it: the test this replaces regex-scanned built JavaScript for `from "…"`, and
 * a chunk embeds every recipe as a string literal, so the engine-selection
 * recipe's `a different axis from "which engine"` was reported as an import.
 * `imports`/`dynamicImports` below are the real thing and cannot be spoofed by
 * prose.
 */
function assertPromptsGraph(): Plugin {
  return {
    name: "assert-prompts-graph",
    generateBundle(_options, bundle) {
      const entry = findEntryChunk(bundle, PROMPTS_ENTRY);
      // Not an error: `build:self`/`build:dev` and any future single-entry
      // build legitimately emit no prompts entry. Nothing to check, not a
      // failure to check it.
      if (entry === undefined) return;

      const binFile = findEntryChunk(bundle, BIN_ENTRY)?.fileName;

      const seen = new Set<string>();
      const queue = [entry.fileName];
      while (queue.length > 0) {
        // A chunk's file name, or — for anything rollup left external — the
        // bare specifier itself, which is why the bundle lookup below can miss.
        const imported = queue.pop()!;
        if (seen.has(imported)) continue;
        seen.add(imported);

        const chunk = bundle[imported];
        if (chunk === undefined || chunk.type !== "chunk") {
          // Resolved to something outside the bundle: an external module.
          this.error(
            `prompts entry graph imports ${imported}; the render path must not ` +
              `reach a host capability`
          );
        }
        if (imported === binFile) {
          this.error(
            `prompts entry graph reaches the CLI entry (${imported}); ` +
              `importing @taskless/cli/prompts would load the command layer`
          );
        }
        queue.push(...chunk.imports, ...chunk.dynamicImports);
      }
    },
  };
}

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __TASKLESS_CLI__: JSON.stringify(cliInvocation),
    __TASKLESS_CLI_NOTICE__: JSON.stringify(cliNotice),
  },
  plugins: [
    tsconfigPaths(),
    assertSkillVersions(),
    shebang(),
    assertPromptsGraph(),
  ],
  build: {
    outDir,
    lib: {
      entry: {
        [BIN_ENTRY]: resolve(import.meta.dirname, "src/index.ts"),
        [PROMPTS_ENTRY]: resolve(import.meta.dirname, "src/prompts/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
    },
  },
  // Much of this suite is integration-shaped rather than unit-shaped: tests in
  // check/runtime-check/init/onboard spawn the real built CLI via
  // `execFile("node", [binPath, ...])`, and several lay out a fixture tree and
  // run `git init` first. One cold CLI spawn measures ~0.8s by itself, so a test
  // doing four or five of them sits at 3-4s before any load at all.
  //
  // Vitest's default 5s testTimeout left no margin for that. Since vitest runs
  // test files in parallel workers competing for CPU, whichever tests happened
  // to land together tipped over: a different set failed on each run, always
  // with "Test timed out in 5000ms" and never an assertion. Verified against a
  // clean checkout of `main` with no local changes, where 8 tests failed this
  // way, so it is the suite's own sizing rather than any one change.
  //
  // 20s swallows the contention without hiding a genuine hang.
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
