import type { CLIErrorCode } from "../types/errors";

/**
 * Sentinel error for expected CLI failures (e.g. validation errors).
 * The top-level catch in index.ts uses this to distinguish expected exits
 * (already printed their own output) from unexpected crashes.
 *
 * An optional `code` (a stable `CLIErrorCode`) lets the runner attribute a
 * `cli_error` telemetry event to a known failure mode. Omitting it is fine;
 * the runner falls back to `INTERNAL_ERROR`.
 */
export class CLIError extends Error {
  override name = "CLIError";
  readonly code?: CLIErrorCode;
  /**
   * Whether this failure has already been shown to the user.
   *
   * The `fail()` helpers print (or emit a JSON envelope) and set `exitCode`
   * before throwing, so the top-level handler must not print again. A throw
   * site that does neither — `resolveIngestEngine`, for one — would otherwise
   * exit 0 with no output, which reads as success. Defaulting to `false` makes
   * "reported" the claim a caller has to make, rather than something the
   * handler assumes of every CLIError.
   */
  readonly reported: boolean;

  constructor(
    message?: string,
    code?: CLIErrorCode,
    options: { reported?: boolean } = {}
  ) {
    super(message);
    this.code = code;
    this.reported = options.reported ?? false;
  }
}
