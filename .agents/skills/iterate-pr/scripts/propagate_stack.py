#!/usr/bin/env python3
"""Cascade-rebase a branch's descendants onto their parents — safely, WITHOUT
touching main. Shell-agnostic (pure subprocess, no zsh word-splitting/globbing).

Use after you commit a fix on branch X and want it carried up to every branch
stacked on top of X. Unlike a whole-stack sync, this never rebases onto the
latest main — fix-propagation stays decoupled from main-reconciliation, and
parents are taken as-is (main is never pulled in).

Lineage is read from the open GitHub PRs (each PR's head -> base), which is the
shared, portable source of truth for stack topology — the same edges the
stack-breadcrumb CI reads. No local config (or any per-machine state) is
required. Processing is topological: a child is rebased only after its parent.

SAFETY GUARDS:
  * Balloon guard — before each rebase the branch's own-commit count is recorded
    (merge-base(parent,child)..child). A rebase can only ever DROP own commits
    (patch-equivalent ones already in the parent), never add them, so any
    increase means the rebase landed on the wrong parent and swept in the upper
    stack. On an increase — or on exceeding the absolute --max-own ceiling — the
    script RESETS the branch back to origin and aborts WITHOUT pushing. This is
    the guard that would have prevented force-pushing garbage to a PR.
  * Checkout — a failed checkout (dirty tree, index lock) aborts immediately.
    Continuing would rebase and force-push whichever branch was checked out.
  * Conflict — on a rebase conflict the rebase is aborted, the conflicting files
    are reported, and the script stops (that boundary needs manual reconcile).
  * Push uses --force-with-lease against a freshly fetched origin; the lease is
    only meaningful if remote-tracking refs are current, so we fetch first.

    uv run ${CLAUDE_SKILL_ROOT}/scripts/propagate_stack.py --root <branch> [--dry-run] [--no-push]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys


def run(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def out(*args: str) -> str:
    r = run(*args)
    return r.stdout.strip() if r.returncode == 0 else ""


def lineage() -> dict[str, str]:
    """child -> parent, derived from open GitHub PRs (head -> base).

    GitHub's PR base/head is the shared, portable source of truth for stack
    topology — the same edges the stack-breadcrumb CI reads — so no local
    config is needed. A branch stacked on another has that branch as its base;
    a root branch's base is main.
    """
    r = subprocess.run(
        ["gh", "pr", "list", "--state", "open", "--limit", "200",
         "--json", "headRefName,baseRefName"],
        capture_output=True, text=True, check=False,
    )
    # Fail fast on a gh error (unauthenticated, offline, API down) rather than
    # returning {} — an empty map would masquerade as "no descendants" and let
    # the run exit 0, silently skipping propagation. Surface gh's own message.
    if r.returncode != 0:
        sys.exit("error: `gh pr list` failed; cannot derive stack lineage:\n"
                 + (r.stderr.strip() or "(no stderr from gh)"))
    try:
        prs = json.loads(r.stdout or "[]")
    except json.JSONDecodeError as e:
        sys.exit(f"error: could not parse `gh pr list` output as JSON: {e}")
    edges: dict[str, str] = {}
    for pr in prs:
        head, base = pr.get("headRefName"), pr.get("baseRefName")
        if head and base:
            edges[head] = base
    return edges


def ref_exists(ref: str) -> bool:
    return run("rev-parse", "--verify", "--quiet", ref).returncode == 0


def count(range_expr: str) -> int:
    s = out("rev-list", "--count", range_expr)
    return int(s) if s.isdigit() else -1


def ordered_descendants(root: str, edges: dict[str, str]) -> list[str]:
    """Return descendants of root in parent-before-child order.

    `seen` is load-bearing, not defensive: GitHub permits a base cycle (A based
    on B while B is based on A), which would otherwise spin here forever — and
    this is the walk that drives rebases and force-pushes.
    """
    children: dict[str, list[str]] = {}
    for child, parent in edges.items():
        children.setdefault(parent, []).append(child)
    ordered: list[str] = []
    seen: set[str] = {root}
    stack = [root]
    while stack:
        b = stack.pop()
        for c in sorted(children.get(b, [])):
            if c in seen:
                continue
            seen.add(c)
            ordered.append(c)
            stack.append(c)
    return ordered


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True, help="Propagate this branch up to its descendants")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan and divergence; do nothing")
    ap.add_argument("--no-push", action="store_true", help="Rebase locally but do not push")
    ap.add_argument("--max-own", type=int, default=15,
                    help="Absolute ceiling on a branch's own commits (fallback when "
                         "the pre-rebase count is unavailable)")
    args = ap.parse_args()

    edges = lineage()
    if args.root not in {p for p in edges.values()} and args.root not in edges:
        print(f"'{args.root}' has no descendants in lineage (nothing to propagate).")
        return 0

    plan = ordered_descendants(args.root, edges)
    if not plan:
        print(f"'{args.root}' has no descendants. Nothing to do.")
        return 0

    print(f"Propagation plan (root {args.root}), parent-before-child:")
    for b in plan:
        print(f"  {edges[b]:30} -> {b}")
    if args.dry_run:
        print("\n(dry-run) no changes made.")
        return 0

    # --force-with-lease compares against remote-tracking refs, so a stale
    # origin/* silently degrades it to a plain --force. Refresh before pushing.
    if not args.no_push:
        fetch = run("fetch", "origin")
        if fetch.returncode != 0:
            print("  ✗ `git fetch origin` failed; --force-with-lease would be "
                  f"unsafe against stale refs. Not pushing.\n{fetch.stderr.strip()}")
            return 5

    start = out("rev-parse", "--abbrev-ref", "HEAD")
    for child in plan:
        parent = edges[child]
        if not ref_exists(child) or not ref_exists(parent):
            print(f"  · skip {child} (missing {child if not ref_exists(child) else parent})")
            continue

        base = out("merge-base", parent, child)
        expected_own = count(f"{base}..{child}") if base else -1

        checkout = run("checkout", child)
        if checkout.returncode != 0:
            print(f"  ✗ could not check out {child}; aborting before any rebase "
                  f"(otherwise the CURRENT branch would be rebased and force-pushed):"
                  f"\n{checkout.stderr.strip()}")
            return 6

        rebase = run("rebase", parent)
        if rebase.returncode != 0:
            conflicts = out("diff", "--name-only", "--diff-filter=U")
            run("rebase", "--abort")
            print(f"  ✗ CONFLICT: {child} onto {parent}. Needs manual reconcile:")
            for f in conflicts.splitlines():
                print(f"        {f}")
            if start:
                run("checkout", start)
            return 2

        actual_own = count(f"{parent}..{child}")
        # A rebase can only drop own commits, never gain them, so ANY increase is
        # a balloon. --max-own is a separate absolute ceiling for the case where
        # expected_own could not be computed (no merge-base).
        ballooned = actual_own > expected_own if expected_own >= 0 else False
        if ballooned or actual_own > args.max_own:
            print(
                f"  ✗ BALLOON GUARD: {child} has {actual_own} commits above {parent} "
                f"(expected at most {expected_own if expected_own >= 0 else args.max_own}). "
                f"Likely rebased onto the wrong parent. NOT pushing."
            )
            reset = run("reset", "--hard", f"origin/{child}")
            if reset.returncode == 0:
                print(f"        reset {child} back to origin/{child}.")
            else:
                print(f"        COULD NOT reset to origin/{child} (unpushed branch?); "
                      f"{child} is left rebased locally and needs manual repair:"
                      f"\n{reset.stderr.strip()}")
            if start:
                run("checkout", start)
            return 3

        if args.no_push:
            print(f"  ✓ {child} rebased onto {parent} (+{actual_own} own) — not pushed (--no-push)")
            continue

        # Explicit remote + branch: never rely on push.default to infer the ref.
        push = run("push", "--force-with-lease", "origin", child)
        if push.returncode != 0:
            print(f"  ✗ push failed for {child}:\n{push.stderr.strip()}")
            if start:
                run("checkout", start)
            return 4
        print(f"  ✓ {child} rebased onto {parent} (+{actual_own} own) — pushed")

    if start:
        run("checkout", start)
    print("\nPropagation complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
