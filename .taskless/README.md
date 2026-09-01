# Taskless

This directory contains [Taskless](https://taskless.io) configuration and rules for static analysis.

## Usage

Run the Taskless scanner from your repository root:

```sh
# npm / pnpm
pnpm dlx @taskless/cli@latest check

# npx
npx @taskless/cli@latest check
```

## Files

- `taskless.json` - Version manifest / migration state
- `.env.local.json` - Local authentication credentials (git-ignored)
- `skills/` - Canonical Taskless skill content; tool directories hold thin stubs that delegate here (managed by Taskless)
- `commands/` - Canonical Taskless command content (managed by Taskless)

Every rule is one directory, `rules/<engine>/<id>/`, holding
everything that defines it. Its test cases sit inside it as
`.tests/`:

- `rules/sg/<id>/` - run by ast-grep; holds `<id>.yml`
- `rules/vale/<id>/` - run by vale-runner; holds `<id>.yml`, `.vale.ini`
- `rules/runtime/<id>/` - run by runtime-harness; holds `check.ts`, `captures/`
