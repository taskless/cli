import { z } from "zod";

/**
 * The `migrated` field carried by every `--json` envelope whose command can
 * migrate `.taskless/` on the way to doing its real work.
 *
 * **Absent when nothing ran.** A caller distinguishes "the working tree was
 * rewritten underneath me" from "nothing happened" by the presence of the
 * field, never by reading empty arrays out of it. Migration remains automatic
 * because `check` and `verify` need a known layout to work at all; this is
 * what makes it observable to something other than a person watching stderr.
 */
export const migratedSchema = z.object({
  from: z
    .number()
    .describe("Scaffold schema version found on disk before migrating"),
  to: z.number().describe("Scaffold schema version after migrating"),
  applied: z
    .array(z.number())
    .describe("Migration versions applied, in the order they ran"),
  files: z
    .object({
      added: z.array(z.string()),
      modified: z.array(z.string()),
      removed: z.array(z.string()),
    })
    .describe("Files the migration touched, relative to the project root"),
});
