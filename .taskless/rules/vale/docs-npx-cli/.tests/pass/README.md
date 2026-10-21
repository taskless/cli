# Getting started

Run npx @taskless/cli to install Taskless into this project.

For a scripted install or upgrade, `npx @taskless/cli@latest init` runs the
same install without prompts, and so does `pnpm dlx @taskless/cli init`.

Logging in works from any version, so `npx @taskless/cli auth login` is fine.

```bash
./.taskless/bin/cli.mjs check
node .taskless/bin/cli.mjs check --json
npx @taskless/cli-nightly@latest --version
```

Other package managers are fine for unrelated work, such as pnpm install
or `pnpm build`, and are not what this rule is about.
