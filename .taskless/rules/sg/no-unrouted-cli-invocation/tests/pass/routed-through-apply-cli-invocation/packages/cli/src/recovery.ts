export function recoveryHint(): string {
  return applyCliInvocation("npx @taskless/cli init");
}
