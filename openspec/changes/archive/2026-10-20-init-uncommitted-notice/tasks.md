## 1. Install commit

- [x] 1.1 Add `install/uncommitted.ts`: the paths an install owns, the uncommitted subset from `git status --porcelain -z`, a commit of exactly those paths, and the batch notice
- [x] 1.2 Export the manifest's recorded permission files from `install/permissions.ts`
- [x] 1.3 Add `wizard/steps/commit.ts`: the three-choice question, the message prompt, and cancel read as don't commit; ask it before the wizard's outro
- [x] 1.4 Print the batch notice above the onboarding trailer in `init`; keep `--json` stdout the envelope alone
- [x] 1.5 Tests: wizard commits only the install with the offered or custom message, from a subdirectory, leaves files on skip and cancel, asks nothing when committed or outside git; batch notice prints without a file list, prints again after an edit, is silent when committed and outside git, `--json` stays parseable

## 2. Onboard recipe

- [x] 2.1 Add the worktree check as step 1 of `onboard.md`, renumber the steps and their cross-references, bump to topic v10
- [x] 2.2 Test the step's position and content in `onboard.test.ts`
- [x] 2.3 Drop the pinned topic version from the `cli-onboard` spec

## 3. Release

- [x] 3.1 Add a patch changeset
