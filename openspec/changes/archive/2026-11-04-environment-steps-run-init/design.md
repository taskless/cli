## Context

`environmentSteps` writes the fixing commands for both `agent ok` and `check`. A bare invocation reaches the wizard only when stdin and stdout are TTYs and `CI` is unset. Otherwise it prints a preamble and the topic index.

## Decisions

**Name `init`, the batch install, in both steps.** It behaves the same with or without a terminal, and it is exempt from the version gate, so the newer CLI can run it in a project that records an older one. The alternative, making a bare non-interactive run install, would turn every piped or agent-run bare invocation into a write.

## Risks / Trade-offs

- [`init` skips the wizard's confirmations, including the global trust entry] → It reports that entry as a `SKIPPED (global):` line and says how to add it, as any scripted install does.
