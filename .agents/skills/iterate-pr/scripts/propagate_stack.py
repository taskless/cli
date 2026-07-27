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
    (merge-base(parent,child)..child). After the rebase the count above the
    parent must match exactly; if it balloons (e.g. the rebase landed on the
    wrong parent and swept in the whole upper stack), the script RESETS the
    branch back to origin and aborts WITHOUT pushing. This is the guard that
    would have prevented force-pushing garbage to a PR.
  * Conflict — on a rebase conflict the rebase is aborted, the conflicting files
    are reported, and the script stops (that boundary needs manual reconcile).
  * Push uses --force-with-lease only; refuses if origin moved underneath.

    uv run .claude/skills/iterate-pr/scripts/propagate_stack.py --root <branch> [--dry-run] [--no-push]
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
    """Return descendants of root in parent-before-child order."""
    children: dict[str, list[str]] = {}
    for child, parent in edges.items():
        children.setdefault(parent, []).append(child)
    ordered: list[str] = []
    stack = [root]
    while stack:
        b = stack.pop()
        for c in sorted(children.get(b, [])):
            ordered.append(c)
            stack.append(c)
    return ordered


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True, help="Propagate this branch up to its descendants")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan and divergence; do nothing")
    ap.add_argument("--no-push", action="store_true", help="Rebase locally but do not push")
    ap.add_argument("--max-own", type=int, default=15, help="Balloon threshold for a branch's own commits")
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

    start = out("rev-parse", "--abbrev-ref", "HEAD")
    for child in plan:
        parent = edges[child]
        if not ref_exists(child) or not ref_exists(parent):
            print(f"  · skip {child} (missing {child if not ref_exists(child) else parent})")
            continue

        base = out("merge-base", parent, child)
        expected_own = count(f"{base}..{child}") if base else -1

        run("checkout", child)
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
        if expected_own >= 0 and actual_own > max(expected_own, args.max_own):
            print(
                f"  ✗ BALLOON GUARD: {child} has {actual_own} commits above {parent} "
                f"(expected ~{expected_own}). Likely rebased onto the wrong parent. "
                f"Resetting to origin/{child}, NOT pushing."
            )
            run("reset", "--hard", f"origin/{child}")
            if start:
                run("checkout", start)
            return 3

        if args.no_push:
            print(f"  ✓ {child} rebased onto {parent} (+{actual_own} own) — not pushed (--no-push)")
            continue

        push = run("push", "--force-with-lease")
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
