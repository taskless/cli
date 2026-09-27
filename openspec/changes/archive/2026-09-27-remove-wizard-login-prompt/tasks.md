## 1. Spec

- [x] 1.1 Remove "Wizard explains the auth tradeoff and offers to log in" and
      add "Wizard does not offer to log in" in its place.
- [x] 1.2 Retitle "Shared interactive login routine" and "Wizard cancellation
      aborts without filesystem writes" as REMOVED plus ADDED, carrying every
      scenario except the one naming the wizard's auth step.
- [x] 1.3 Dry-run `openspec archive` and confirm every other scenario in
      `cli-init` survives.

## 2. Code

- [x] 2.1 Delete `wizard/steps/auth.ts` and its call in `runWizard`.
- [x] 2.2 Drop `authPromptShown` / `authCompleted` from `WizardResult`.
- [x] 2.3 Update the `loginInteractive` comments that named the wizard.
- [x] 2.4 Remove the "log in" branch from the wizard test's clack mock, so a
      reintroduced login confirm would be answered as the summary confirm and
      fail the tests' expectations on its message.
- [x] 2.5 Add a wizard test that runs with no token and asserts no confirm
      mentions logging in. Checked by inserting a login confirm into the
      wizard: the test fails, and passes once it is removed.

## 3. Release

- [x] 3.1 Add a `patch` changeset.
