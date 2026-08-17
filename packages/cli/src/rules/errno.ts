/**
 * Whether an `fs` failure genuinely means "that directory is not there".
 *
 * `ENOENT` is the path not existing; `ENOTDIR` is a path that exists but is a
 * file, or that has a file for an ancestor. Every other code — `EACCES` above
 * all — is a real IO problem, and reading it as "nothing here" is what makes an
 * unreadable bucket indistinguishable from an unwritten one.
 *
 * One definition, so no caller can accidentally answer that question
 * differently: two spellings of "absent" drift, and the drift is silent.
 */
export function isMissingDirectory(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const { code } = error as NodeJS.ErrnoException;
  return code === "ENOENT" || code === "ENOTDIR";
}
