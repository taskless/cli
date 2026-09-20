#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Lists the unarchived OpenSpec change directories and writes three step
# outputs to $GITHUB_OUTPUT: `ok`, `changes` and `error`. See action.yml for
# what each one means and why the caller, not this script, owns the failure
# response.
#
# THIS SCRIPT EXITS ZERO. Every one of its callers reports through a label, a
# job summary or an issue and none of them may fail a check for a reason
# unrelated to the change being reported on, so a failed listing is an
# output here, never an exit status. `set -e` is deliberately absent: the
# two commands whose failure matters are tested explicitly, and an abort in
# between them would be a red check with nothing to say.
#
# THE LISTING IS DELEGATED TO openspec-tracking.cjs --list RATHER THAN TO A
# SHELL `find`. A `find` form can always be made portable for today's shapes
# (the workflows once carried `-printf '%f\n'`, a GNU extension BSD find
# rejects, fixed once to `-exec basename {} \;`), but that is a property
# someone has to get right again every time the listing changes. Routing it
# through `readdirSync`, already covered by openspec-tracking.test.cjs,
# removes the question of which `find` flags are portable rather than
# answering it correctly this once.
#
# THE EXIT STATUS IS A VALUE, NOT AN EVENT. The workflows captured it with
# `if ! raw=$(...)` so that `set -e` could not abort the step in assignment
# position; here `set -e` is off and the status is read from `$?` on the
# next line. Either way an unreadable `openspec/changes` must read as "could
# not tell" rather than as "resolved": reporting it as zero unarchived
# changes would tell a stack its change is done, or close every open
# tracking issue as archived, when nobody checked.
#
# STDERR GOES TO A FILE, NEVER INTO THE CAPTURED VALUE. This read `2>&1` to
# keep the warning informative, which folds anything node writes to stderr
# into the JSON. Node writes to stderr while exiting zero all the time: an
# ExperimentalWarning, a deprecation notice from a newer runner image, a
# NODE_OPTIONS preload message. The exit-status guard does not fire on any
# of them, and `jq` then fails on the polluted value. Measured with a single
# `(node:1) Warning: something at startup` line: `jq: parse error: Invalid
# numeric literal`, exit 5, which was a red check on a pull request in one
# caller and an empty listing that closed every open tracking issue as
# archived in another. The stderr text is still available for the error
# output, it is just read from the file on the failure branch.
#
# THE VALUE IS VALIDATED BEFORE IT IS WRITTEN. A listing that exits zero but
# does not parse as a JSON array of strings is the same "could not tell" as
# a listing that failed, and takes the same path. Doing that here means a
# consumer can hand `changes` to `jq` in assignment position under `set -e`
# without a second guard, because the only value that ever reaches it has
# already parsed.

set -uo pipefail

out="${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"

# `error` is one line. $GITHUB_OUTPUT is line-oriented, and the message is
# only ever read inside a `::warning::` annotation, which is also one line.
report() {
  local ok="$1" changes="$2" error="$3"
  error=$(printf '%s' "$error" | tr '\n' ' ' | sed 's/[[:space:]]*$//')
  {
    echo "ok=$ok"
    echo "changes=$changes"
    echo "error=$error"
  } >>"$out"
}

stderr_file=$(mktemp)
trap 'rm -f "$stderr_file"' EXIT

# `$?` is read on the line after the assignment rather than inside an
# `if ! raw=$(...)`, where it would already be the status of the `!`.
raw=$(node .github/scripts/openspec-tracking.cjs --list 2>"$stderr_file")
status=$?
if [ "$status" -ne 0 ]; then
  report false "" "exit status $status: $(cat "$stderr_file")"
  exit 0
fi

# `-e` makes jq exit non-zero when the filter yields false, so anything that
# is not an array of strings is rejected here and never reaches a consumer.
if ! changes=$(jq -c -e 'if type == "array" and all(type == "string") then . else false end' <<<"$raw" 2>"$stderr_file"); then
  report false "" "listing did not parse as a JSON array of strings: $(cat "$stderr_file")"
  exit 0
fi

report true "$changes" ""
