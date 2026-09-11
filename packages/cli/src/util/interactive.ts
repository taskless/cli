/**
 * Whether a bare invocation should launch the interactive wizard.
 *
 * Both streams must be TTYs: clack reads from stdin, so a piped stdin would
 * hang the wizard even when stdout is a terminal. And `CI` wins over the
 * TTYs. Some automated environments allocate a pseudo-terminal on both
 * streams (`docker run -it`, pty-allocating runners), so TTY detection alone
 * would launch the wizard into a job nobody is watching, and it would wait
 * there for input that never comes. The batch path, `init`, is what such a
 * job wants, and the non-TTY preamble is what says so.
 *
 * Pure so it can be tested: a spawned CLI is never on a TTY, which is exactly
 * the case this guard does not decide.
 */
export function shouldLaunchWizard(input: {
  stdoutIsTTY: boolean | undefined;
  stdinIsTTY: boolean | undefined;
  ci: string | undefined;
}): boolean {
  if (input.ci === "true" || input.ci === "1") return false;
  return input.stdoutIsTTY === true && input.stdinIsTTY === true;
}
