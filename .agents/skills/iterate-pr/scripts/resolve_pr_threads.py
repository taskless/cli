#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""
Resolve PR review threads by their GraphQL node IDs.

Usage:
    python resolve_pr_threads.py THREAD_ID [THREAD_ID ...]

Each THREAD_ID is a GraphQL node ID (e.g., PRRT_kwDOQLIDeM51Bg43).

Output: JSON to stdout with results for each thread.

Example output:
{
  "resolved": ["PRRT_kwDOQLIDeM51Bg43", "PRRT_kwDOQLIDeM51Bg5G"],
  "failed": [],
  "already_resolved": []
}
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Any


def run_gh_graphql(query: str) -> dict[str, Any]:
    """Run a GraphQL query via gh api."""
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return {"errors": [{"message": result.stderr.strip()}]}
    return json.loads(result.stdout)


def check_thread_resolved(thread_id: str) -> bool | None:
    """Check if a thread is already resolved. Returns None on error."""
    query = f'{{ node(id: "{thread_id}") {{ ... on PullRequestReviewThread {{ isResolved }} }} }}'
    data = run_gh_graphql(query)
    node = data.get("data", {}).get("node")
    if node is None:
        return None
    return node.get("isResolved", False)


def resolve_thread(thread_id: str) -> bool:
    """Resolve a single review thread. Returns True on success."""
    query = (
        f'mutation {{ resolveReviewThread(input: {{threadId: "{thread_id}"}}) '
        f"{{ thread {{ isResolved }} }} }}"
    )
    data = run_gh_graphql(query)
    thread = (
        data.get("data", {}).get("resolveReviewThread", {}).get("thread", {})
    )
    return thread.get("isResolved", False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Resolve PR review threads by GraphQL node ID"
    )
    parser.add_argument(
        "thread_ids",
        nargs="+",
        metavar="THREAD_ID",
        help="GraphQL node IDs of threads to resolve",
    )
    args = parser.parse_args()

    resolved: list[str] = []
    failed: list[str] = []
    already_resolved: list[str] = []

    for thread_id in args.thread_ids:
        # Check if already resolved
        is_resolved = check_thread_resolved(thread_id)
        if is_resolved is True:
            already_resolved.append(thread_id)
            continue

        # Attempt to resolve
        if resolve_thread(thread_id):
            resolved.append(thread_id)
        else:
            failed.append(thread_id)

    output = {
        "resolved": resolved,
        "failed": failed,
        "already_resolved": already_resolved,
    }
    print(json.dumps(output, indent=2))

    # Exit with error if any failed
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
