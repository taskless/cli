import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseAllDocuments } from "yaml";

import { resolveAstGrepLanguage } from "../capabilities";
import type { RuleMigration } from "../rule-migrate";

/**
 * Rename the Haskell kind `type_synomym` to `type_synonym`.
 *
 * ast-grep 0.50.0 moved tree-sitter-haskell from 0.23.1 to 0.24.1, which
 * fixed the typo in that kind's name (`fix!: typo: 'synomym' -> 'synonym'`).
 * Diffed across both grammars' node-types.json, it is the only named kind or
 * field that changed. A rule still naming the old kind exits 8, and `check`
 * loads every sg rule into one config, so it reports no sg findings at all.
 * Pinned in `test/ast-grep-vendor-contract.test.ts`.
 *
 * Only `kind:` values are rewritten, and only in a rule whose `language`
 * resolves to Haskell: the name means nothing in another grammar, and a
 * message mentioning it is the author's prose. Fixtures under `.tests/` are
 * Haskell source, not kind names, and are never read.
 *
 * The Taskless service has issued no rule naming the old kind, so no issued
 * rule's signature is affected.
 */
const OLD_KIND = /(\bkind[ \t]*:[ \t]*)(["']?)type_synomym\2(?![\w-])/g;

/** Whether any document in `source` declares a language that is Haskell. */
function isHaskellRule(source: string): boolean {
  try {
    return parseAllDocuments(source).some((document) => {
      const language: unknown = document.get("language");
      return (
        typeof language === "string" &&
        resolveAstGrepLanguage(language) === "Haskell"
      );
    });
  } catch {
    // A file that does not parse is not ours to rewrite; `validate` names it.
    return false;
  }
}

/** `source` with every `kind: type_synomym` renamed. */
export function renameTypeSynonymKind(source: string): string {
  return source.replaceAll(OLD_KIND, "$1$2type_synonym$2");
}

const migration: RuleMigration = {
  engine: "sg",
  engineVersion: "0.50.0",
  summary: "Haskell kind `type_synomym` renamed to `type_synonym`",
  async apply(engineDirectory) {
    let ruleDirectories;
    try {
      ruleDirectories = await readdir(engineDirectory, { withFileTypes: true });
    } catch {
      // No sg rules tree: nothing to rewrite.
      return [];
    }
    const written: string[] = [];
    for (const ruleDirectory of ruleDirectories) {
      if (!ruleDirectory.isDirectory()) continue;
      const files = await readdir(join(engineDirectory, ruleDirectory.name), {
        withFileTypes: true,
      });
      for (const file of files) {
        if (!file.isFile() || !/\.ya?ml$/.test(file.name)) continue;
        const path = join(engineDirectory, ruleDirectory.name, file.name);
        const source = await readFile(path, "utf8");
        if (!isHaskellRule(source)) continue;
        const renamed = renameTypeSynonymKind(source);
        if (renamed === source) continue;
        await writeFile(path, renamed, "utf8");
        written.push(join(ruleDirectory.name, file.name));
      }
    }
    return written;
  },
};

export default migration;
