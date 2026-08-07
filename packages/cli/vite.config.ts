import { builtinModules } from "node:module";
import { chmodSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { SKILL_CATALOG } from "./src/install/catalog";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")
) as { version: string };

// Each build target emits to its own directory so prod, dev, and self builds
// never overwrite one another. Keyed by TASKLESS_BUILD_TARGET; anything other
// than "dev"/"self" is treated as prod.
const OUT_DIRS = {
  prod: "dist",
  dev: "dist-dev",
  self: "dist-self",
} as const;

function resolveBuildTarget(): keyof typeof OUT_DIRS {
  const target = process.env.TASKLESS_BUILD_TARGET;
  return target === "dev" || target === "self" ? target : "prod";
}

function resolveOutDir(): string {
  return OUT_DIRS[resolveBuildTarget()];
}

// The CLI invocation baked into emitted skill/command/recipe content, chosen
// by the TASKLESS_BUILD_TARGET env var (see package.json build:dev/build:self):
//   - prod (default): the published `npx @taskless/cli`
//   - dev:  an absolute path, for validating this build from another repo
//   - self: a repo-root-relative path, for dogfooding inside this repo
// The dev/self paths point at their own output directory (dist-dev/dist-self).
function resolveCliInvocation(): string {
  switch (resolveBuildTarget()) {
    case "self": {
      return `node packages/cli/${OUT_DIRS.self}/index.js`;
    }
    case "dev": {
      return `node ${resolve(import.meta.dirname, OUT_DIRS.dev, "index.js")}`;
    }
    default: {
      return "npx @taskless/cli";
    }
  }
}

// A one-time banner prepended to canonical skill/command bodies for non-prod
// builds, so an agent that's told to call the local CLI knows how to produce it
// if the build artifact is missing. Empty for prod (no banner is emitted).
function resolveCliNotice(): string {
  const target = process.env.TASKLESS_BUILD_TARGET;
  if (target !== "self" && target !== "dev") return "";
  const rebuild = target === "self" ? "pnpm build:self" : "pnpm build:dev";
  return (
    `> **Local Taskless build.** The commands below call a locally built CLI ` +
    `(\`${resolveCliInvocation()}\`). If that path does not exist yet, run ` +
    `\`${rebuild}\` from the repo root first.`
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

function shebang(): Plugin {
  return {
    name: "shebang",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
          chunk.code = "#!/usr/bin/env node\n" + chunk.code;
        }
      }
    },
    writeBundle(options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
          const outPath = resolve(options.dir ?? resolveOutDir(), fileName);
          chmodSync(outPath, 0o755);
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __TASKLESS_CLI__: JSON.stringify(resolveCliInvocation()),
    __TASKLESS_CLI_NOTICE__: JSON.stringify(resolveCliNotice()),
  },
  plugins: [tsconfigPaths(), assertSkillVersions(), shebang()],
  build: {
    outDir: resolveOutDir(),
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
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
