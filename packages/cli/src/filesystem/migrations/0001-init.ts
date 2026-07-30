import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { addToGitignore } from "../gitignore";
import type { Migration } from "../types";

const MANIFEST_FILE = "taskless.json";

/** Fields present on v0 manifests that are obsolete in v1. */
const V0_LEGACY_FIELDS = ["orgId", "repositoryUrl", "astGrepVersion"] as const;

const README_CONTENT = `# Taskless

This directory contains [Taskless](https://taskless.io) configuration and rules for static analysis.

## Usage

Run the Taskless scanner from your repository root:

\`\`\`sh
# npm / pnpm
pnpm dlx @taskless/cli@latest check

# npx
npx @taskless/cli@latest check
\`\`\`

## Files

- \`taskless.json\` - Version manifest / migration state
- \`.env.local.json\` - Local authentication credentials (git-ignored)
- \`skills/\` - Canonical Taskless skill content; tool directories hold thin stubs that delegate here (managed by Taskless)
- \`commands/\` - Canonical Taskless command content (managed by Taskless)
- \`rules/\` - Generated ast-grep rules (managed by Taskless)
- \`rule-tests/\` - Rule tests containing pass/fail examples for your rules
`;

const migration: Migration = async (directory) => {
  // Always write README.md (overwrite stale content from older versions)
  await writeFile(join(directory, "README.md"), README_CONTENT, "utf8");

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
