/**
 * `unsupported` is a terminal status: the request was understood, and the
 * answer is that it cannot be served as asked. Not a transient failure to
 * retry, and deliberately not `failed` — nothing failed, so a user reading
 * "generation failed" would go looking for a service bug rather than for the
 * thing they actually have to change.
 *
 * WHAT HAS TO CHANGE IS NOT ALWAYS THE PLAN, AND WE USED TO SAY IT WAS. This
 * message was hardcoded to an entitlement explanation and ignored the `error`
 * the service sends with the status. The service now terminates a request as
 * unsupported when the CLI is below the floor a runtime rule needs, with a
 * reason that says so — and a user on an old CLI was being told to upgrade
 * their PLAN. They would have asked an administrator for a capability they
 * already had, and the one command that would have fixed it was never
 * mentioned.
 *
 * So the service's reason wins whenever it sends one, and the entitlement text
 * is the fallback for a terminal `unsupported` that arrives without one.
 */
export function unsupportedMessage(reason?: string): string {
  if (reason !== undefined && reason.trim() !== "") {
    return `This rule generation can't be served as requested.\n\n${reason}`;
  }
  return [
    "This rule generation isn't available on your current Taskless plan.",
    "",
    "It may need a capability that isn't enabled for your organization yet (for example, runtime rules). Ask your Taskless administrator or upgrade your plan to enable it.",
  ].join("\n");
}
