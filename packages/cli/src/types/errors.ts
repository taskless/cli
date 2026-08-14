/**
 * Stable error codes emitted by CLI commands when --json is set.
 * Recipes reference these codes by name in their `## Errors` section,
 * so renaming a code is a breaking change for the agent contract.
 *
 * Add new codes by extending the union; do not rename existing codes
 * without a major version bump.
 */
export type CLIErrorCode =
  | "AUTH_REQUIRED"
  | "NO_GITHUB_REMOTE"
  | "RULE_GENERATION_FAILED"
  | "RULE_UNSUPPORTED"
  | "RULE_NOT_FOUND"
  | "INVALID_INPUT"
  | "NETWORK_ERROR"
  | "SCAN_FAILED"
  // An engine binary is not present on this host — an ordinary state on an
  // unsupported architecture, and distinct from the engine running and
  // failing. Kept apart from SCAN_FAILED because the two ask the caller for
  // different things: install something, versus fix something.
  | "ENGINE_UNAVAILABLE"
  | "RECONCILE_FAILED"
  | "SCAFFOLD_VERSION_MISMATCH"
  | "SCAFFOLD_CONFLICT"
  | "INTERNAL_ERROR";

/**
 * Standardized JSON error envelope written to stdout when an action
 * command exits with an error AND `--json` was set.
 */
export interface CLIErrorEnvelope {
  ok: false;
  code: CLIErrorCode;
  message: string;
}

export function makeErrorEnvelope(
  code: CLIErrorCode,
  message: string
): CLIErrorEnvelope {
  return { ok: false, code, message };
}

export function writeJsonError(code: CLIErrorCode, message: string): void {
  console.log(JSON.stringify(makeErrorEnvelope(code, message)));
}
