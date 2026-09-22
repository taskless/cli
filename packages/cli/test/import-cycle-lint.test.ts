import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A guard that `import-x/no-cycle` is actually ON and actually reaching
 * `packages/cli/src`.
 *
 * This does NOT re-implement cycle detection — that would be exactly the
 * "re-derive what the tool already knows" mistake the style guide forbids.
 * Every assertion below asks ESLint, running the repository's real
 * `eslint.config.js`, and checks what it answers.
 *
 * It exists because the rule's failure mode is silence. While this rule was
 * being added, the config resolved correctly, matched the right files, and
 * reported `import-x/no-cycle` as an enabled error — and still found nothing on
 * a tree that provably contained a cycle, because `import-x/extensions`
 * defaults to `['.js', '.mjs', '.cjs']` and so every `.ts` file was dropped
 * before its imports were read. A green `pnpm lint` looked identical whether
 * the rule was working or inert. Nothing but an actual cycle distinguishes
 * those two states, which is why the second test below writes one.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const CLI_SOURCE = resolve(REPO_ROOT, "packages/cli/src");

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map(async (directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

function createESLint(): ESLint {
  return new ESLint({ cwd: REPO_ROOT });
}

describe("import-x/no-cycle", () => {
  it("is enabled as an error for files in packages/cli/src", async () => {
    const config = (await createESLint().calculateConfigForFile(
      join(CLI_SOURCE, "index.ts")
    )) as { rules?: Record<string, unknown> };

    // "error" is 2 once ESLint normalizes it. A config block that stopped
    // matching `packages/cli/src` would leave this undefined.
    expect(config.rules?.["import-x/no-cycle"]).toBeDefined();
    expect((config.rules?.["import-x/no-cycle"] as unknown[])[0]).toBe(2);
  });

  it("reports a value cycle written into packages/cli/src", async () => {
    // Written inside `packages/cli/src` on purpose: the point of the check is
    // that the rule reaches THIS tree, so linting a fixture parked somewhere
    // the config does not match would prove nothing. The directory name is
    // prefixed so it is obviously not product code if cleanup is ever missed.
    const directory = await mkdtemp(join(CLI_SOURCE, "__cycle-guard-"));
    temporaryDirectories.push(directory);

    // A -> B -> A over VALUE imports. Kept to real value edges because
    // type-only edges are erased before the module runs and the rule ignores
    // them by design; see the note in eslint.config.js.
    await writeFile(
      join(directory, "a.ts"),
      'import { b } from "./b";\n\nexport const a = (): string => b();\n'
    );
    await writeFile(
      join(directory, "b.ts"),
      'import { a } from "./a";\n\nexport const b = (): string => a();\n'
    );

    const results = await createESLint().lintFiles([join(directory, "*.ts")]);
    const cycleMessages = results.flatMap((result) =>
      result.messages.filter(
        (message) => message.ruleId === "import-x/no-cycle"
      )
    );

    expect(cycleMessages.length).toBeGreaterThan(0);
  });
});
