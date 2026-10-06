## 1. Spec

- [x] 1.1 MODIFIED `cli-auth` requirements restated in full under their
      existing titles; REMOVED the two global-store requirements; ADDED the
      environment-first resolution and rejected-token requirements.
- [x] 1.2 Dry-run `openspec archive` and confirm every prior scenario survives
      or is accounted for in the proposal.

## 2. Behavior

- [x] 2.1 `isEnvironmentToken` and `rejectedTokenRemedy` in `auth/token.ts`.
- [x] 2.2 `auth login` replaces a saved token the service rejects; reports the
      token's source when it keeps one.
- [x] 2.3 `auth logout` and `taskless auth` name `TASKLESS_TOKEN`; status
      separates a rejected token from an unreachable service.

## 3. Messages

- [x] 3.1 Every `unauthorized` outcome uses the shared remedy: recover,
      plan-check, generation poll and fetch, submit.
- [x] 3.2 Organization-not-found hint names `auth logout` then `auth login`.

## 4. Recipes and changeset

- [x] 4.1 `auth` recipe topic v2.
- [x] 4.2 `rejected-token-recovery` changeset.

## 5. Tests

- [x] 5.1 `loginInteractive`: environment token skips the service; accepted
      and unreachable keep the token; rejected is replaced.
- [x] 5.2 `rejectedTokenRemedy` with and without `TASKLESS_TOKEN`.
- [x] 5.3 Built CLI: `auth logout` and `auth login` with `TASKLESS_TOKEN` set.
