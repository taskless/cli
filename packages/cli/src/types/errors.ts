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
  | "RECONCILE_FAILED"
  | "SCAFFOLD_VERSION_MISMATCH"
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
