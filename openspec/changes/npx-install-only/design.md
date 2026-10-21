## Context

The version-pin gate leaves npx exactly one legitimate use in a project: installing or upgrading. The installed skill and the recipes already name the launcher. Docs, one Vale rule, and two lines of CLI output did not.

## Decisions

- **The Vale rule lists subcommands rather than matching "any word but init".** A negative lookahead on the next word flags prose such as "run npx @taskless/cli to install". Listing every subcommand except `init` is exact, and a new subcommand is a one-line addition.
- **Flags stay allowed.** `npx @taskless/cli-nightly@latest --version` is how CONTRIBUTING checks a nightly. `--version` is intercepted before the gate, so it never conflicts.
- **The upgrade trailer uses `buildLauncherInvocation()`, falling back to `getCliPrefix()`.** `init` just wrote that launcher, and it runs the version the project now records. A `self` build has no launcher and keeps its path.
- **The bare notice checks the file, not the build alone.** The bare invocation is exempt from the gate and runs in projects that were never installed, so it names the launcher only when `.taskless/bin/cli.mjs` exists under the target directory.
- **Error remedies keep `getCliPrefix()`.** A remedy repeats how the person ran the CLI. Under the gate, any npx run that gets far enough to print one is already the recorded version, so the remedy runs. Changing roughly twenty call sites is not worth it for no behavioural difference.

## Risks / Trade-offs

- The Vale rule's subcommand list can drift from the CLI. A missed subcommand is a false negative in docs, not a refusal.
