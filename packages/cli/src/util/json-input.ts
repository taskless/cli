import { readFile } from "node:fs/promises";

import type { ZodError, ZodType } from "zod";

/**
 * One line per issue, each led by the field path it is about. A request file
 * is usually written by an agent, and "expected string, received undefined"
 * is only actionable once it says which field. Issues are joined with "; "
 * because zod's own messages already contain commas.
 */
export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
    .join("; ");
}

/**
 * Node's read errors end in `, open '<path>'`, repeating the path the caller
 * already names. Keep the code and its description: "ENOENT: no such file or
 * directory".
 */
function readReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { syscall, path } = error as NodeJS.ErrnoException;
  return syscall && path
    ? error.message.replace(`, ${syscall} '${path}'`, "")
    : error.message;
}

/**
 * Read a `--from` request file, parse it as JSON and validate it.
 *
 * Throws an `Error` whose message is ready to show the user: it names the
 * resolved path, and carries the underlying reason (the `ENOENT`/`EISDIR`
 * from the read, the parser's position, the failing field paths) rather than
 * collapsing every failure into one sentence.
 */
export async function readJsonInput<T>(
  filePath: string,
  schema: ZodType<T>
): Promise<T> {
  let fileContent: string;
  try {
    fileContent = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read file "${filePath}": ${readReason(error)}`);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fileContent) as unknown;
  } catch (error) {
    throw new Error(
      `"${filePath}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = schema.safeParse(rawJson);
  if (!result.success) {
    throw new Error(`Invalid input: ${formatZodIssues(result.error)}`);
  }
  return result.data;
}
