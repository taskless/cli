# Tasks

Delivery shape: **single PR**. The entry and the guard that makes its exemption
reviewable land together; apart, the first ships an unchecked published surface.

## 1. Give the ast-grep spec a leaf module

- [x] 1.1 Move `AST_GREP_BINARY` from `src/rules/scan.ts` to
      `src/rules/ast-grep-binary.ts`, and say in the comment why it lives alone:
      `scan.ts` reaches `rules/engines.ts` and through it `node:fs/promises` and
      the CLI's error type, none of which a consumer asking for a path needs.
- [x] 1.2 Point `scan.ts` and the two tests that name it at the new module.
      `VALE_BINARY` needs no move; `rules/vale/binary.ts` already imports nothing
      but the resolver.

## 2. The entry

- [x] 2.1 Add `src/node/runtimes/index.ts` re-exporting `resolvePlatformBinary`,
      `platformPackageName`, `pathCommandName`, `findOnPath`, `isPlatformBinary`,
      both specs, and `PlatformBinarySpec` / `PlatformBinaryResolution`.
      `.js` extensions on the specifiers, as on the other published entries, or
      `tsc` copies extensionless paths into the emitted `.d.ts` and a consumer on
      `node16` resolution cannot follow them.
- [x] 2.2 Document that a miss is a value rather than an exception, and that a
      verifier should fail closed on it while `check` deliberately does not.
- [x] 2.3 Add the `./node/runtimes` export and the vite entry.
- [x] 2.4 Add the entry to `tsconfig.public.json` so its types ship.

## 3. Make the classification exhaustive

- [x] 3.1 Derive the vite entry map from one `ENTRY_SOURCES` record, so the
      classification check and the build read the same list.
- [x] 3.2 Add `HOST_BOUND_ENTRIES`, and `assertExportsClassified()`, which fails
      the build when a published export names no built entry or appears in
      neither classification.
- [x] 3.3 Apply the CLI-entry rule to host-bound entries too, and state at both
      lists that absence is no longer an exemption.
- [x] 3.4 Verify it bites, three ways: an export naming an unbuilt entry; the new
      entry removed from `HOST_BOUND_ENTRIES`, which is the exempt-by-omission
      case; and the entry importing `src/index.ts`.

## 4. The chunk-versus-module correction

- [x] 4.1 The CLI-entry rule compared against the bin chunk's file name, and task
      3.4's third test found that evadable: importing `src/index.ts` from a
      library entry made rollup hoist the CLI into a shared chunk and leave
      `dist/index.js` a 50-byte re-export facade, which the library entry did not
      import. The check reported nothing while the entry carried the whole
      command layer. Compare against the bin entry's module id instead, which
      chunking cannot move.

## 5. Checks

- [x] 5.1 `pnpm build`, `pnpm typecheck`, `pnpm lint`,
      `pnpm --filter @taskless/cli exec vitest run`, `pnpm cli check`.
- [x] 5.2 Prove the built artifact, not the source: import
      `@taskless/cli/node/runtimes` by its published specifier from outside the
      package and resolve both engines, showing each path and that identity
      verified.
- [x] 5.3 Changeset, `patch`.

## 6. Close out

- [ ] 6.1 Archive the change. Archiving is what promotes the delta into the
      standing spec.
