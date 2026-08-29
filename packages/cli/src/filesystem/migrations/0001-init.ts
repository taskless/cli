import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { addToGitignore } from "../gitignore";
import type { Migration } from "../types";
import { buildInvocation } from "../../util/invocation";
import { pinnedSpecifier } from "../../util/package-manager";

const MANIFEST_FILE = "taskless.json";

/** Fields present on v0 manifests that are obsolete in v1. */
const V0_LEGACY_FIELDS = ["orgId", "repositoryUrl", "astGrepVersion"] as const;

/**
 * The `sh` block that tells a reader how to run `check`.
 *
 * The invocation has two halves that come from different places (see
 * `util/package-manager.ts`). The **specifier** is a build-time fact, and it is
 * the half that was wrong: a nightly wrote `@taskless/cli@latest` into a file
 * it had just installed as `@taskless/cli-nightly`, sending the reader to
 * install the release over the nightly they were exercising. Both lines take
 * the specifier this build is actually reachable by.
 *
 * The **launcher** half stays a menu, in every build. This file is written once
 * and read much later, by someone who may reach for either package manager, so
 * both are listed rather than detected. Detecting would make the bytes depend
 * on how this particular run happened to be launched, and the migration
 * overwrites the file on every run, so a committed `.taskless/README.md` would
 * churn between contributors.
 *
 * `specifier` is `undefined` only for a path-form (`self`) build, which names
 * no package at all. A path has no launcher to choose between, so that build
 * gets the one invocation it has.
 */
function usageBlock(specifier: string | undefined): string {
  if (specifier === undefined) {
    return `${buildInvocation()} check`;
  }
  return [
    "# npm / pnpm",
    `pnpm dlx ${specifier} check`,
    "",
    "# npx",
    `npx ${specifier} check`,
  ].join("\n");
}

/**
 * The `.taskless/README.md` body for a build reachable by `specifier`.
 *
 * Takes the specifier rather than reading the build define so the nightly case
 * is a value a test can pass. Every build target other than prod is otherwise
 * unreachable from a test process, which is how a nightly shipped a README
 * naming the released package for as long as it did.
 */
export function buildReadmeContent(specifier: string | undefined): string {
  return `# Taskless

This directory contains [Taskless](https://taskless.io) configuration and rules for static analysis.

## Usage

Run the Taskless scanner from your repository root:

\`\`\`sh
${usageBlock(specifier)}
\`\`\`

## Files

- \`taskless.json\` - Version manifest / migration state
- \`.env.local.json\` - Local authentication credentials (git-ignored)
- \`skills/\` - Canonical Taskless skill content; tool directories hold thin stubs that delegate here (managed by Taskless)
- \`commands/\` - Canonical Taskless command content (managed by Taskless)

Rules are partitioned by the engine that runs them. Each engine directory holds
that tool's own native config, its \`rules/\`, and its \`rule-tests/\`:

- \`sg/\` - ast-grep: \`sgconfig.yml\`, generated rules (managed by Taskless), and their pass/fail test cases
- \`vale/\` - Vale prose rules: \`.vale.ini\`, \`rules/\`, and their pass/fail fixtures. Run by \`check\` alongside ast-grep
- \`runtime/\` - Rules that execute a \`check.ts\`, each in its own \`rules/<name>/\` directory
`;
}

const migration: Migration = async (directory) => {
  // Always write README.md (overwrite stale content from older versions)
  await writeFile(
    join(directory, "README.md"),
    buildReadmeContent(pinnedSpecifier()),
    "utf8"
  );

  // Ensure .gitignore has required entries
  const cwd = join(directory, "..");
  // `/sgconfig.yml` is anchored to `.taskless/` on purpose: an unanchored
  // pattern matches at any depth and would also ignore the committed
  // `.taskless/sg/sgconfig.yml`. Migration 0004 rewrites the unanchored form
  // that earlier versions of this migration wrote.
  await addToGitignore(cwd, [".env.local.json", "/sgconfig.yml"]);

  // Create subdirectories
  await mkdir(join(directory, "rules"), { recursive: true });
  await mkdir(join(directory, "rule-tests"), { recursive: true });

  // Strip legacy v0 fields from taskless.json if present
  const manifestPath = join(directory, MANIFEST_FILE);
  try {
    const content = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      const raw = parsed as Record<string, unknown>;
      let touched = false;
      for (const field of V0_LEGACY_FIELDS) {
        if (field in raw) {
          delete raw[field];
          touched = true;
        }
      }
      if (touched) {
        await writeFile(
          manifestPath,
          JSON.stringify(raw, null, 2) + "\n",
          "utf8"
        );
      }
    }
  } catch {
    // Missing or unparseable manifest — the migration runner will handle
  }
};

export default migration;
