## 1. Spec

- [x] 1.1 MODIFIED `cli-init` requirement restated in full under its existing
      title; ADDED `cli` requirement for `info`.
- [x] 1.2 Dry-run `openspec archive` and confirm every prior scenario survives.

## 2. Detector

- [x] 2.1 Read workspace patterns from `pnpm-workspace.yaml` and `workspaces`.
- [x] 2.2 Expand them with `fs.glob`, honouring negation, skipping absolute and
      `..` patterns and `node_modules`, bounded at 500 manifests.
- [x] 2.3 Resolve the installed version from the package directory up to the
      working directory.
- [x] 2.4 Add `manifest` to each pin and to the notice line.

## 3. info

- [x] 3.1 `pinnedCli` on the `info` schema and payload; plain output lists pins.

## 4. Recipes and changeset

- [x] 4.1 `update` v15 reads pins from `info --json`; `info` v2; `init` v4.
- [x] 4.2 Extend the `init-stale-cli-pins` changeset.

## 5. Tests

- [x] 5.1 Detector: both workspace sources, root-first order, negation, `**`
      past `node_modules`, escaping patterns, own-link versus hoisted
      installs, malformed root with `pnpm-workspace.yaml`.
- [x] 5.2 `info --json` and plain `info` integration; `init --json` carries
      `manifest`.
