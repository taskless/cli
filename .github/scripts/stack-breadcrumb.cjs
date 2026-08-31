// SPDX-License-Identifier: MIT
// Adapted from the taskless/taskless stack-breadcrumb implementation
// (@taskless/stack-breadcrumb) and brought into this repository under its MIT
// license, with permission.
//
// THIS COPY IS THE AUTHORITATIVE ONE, and copies exist downstream: taskless/taskless
// vendors it rather than maintaining its own. Fixes are made here and re-vendored
// from here, so a change made downstream is a fork that the next sync discards.
//
// Nothing checks that the copies match, deliberately. This repository moves ahead
// of the vendored copy by design, so a drift test would fail on exactly the changes
// that are supposed to happen. The stakes suit that: a diverged breadcrumb renders a
// PR body slightly differently, where a diverged rule layout writes rules to the
// wrong place — which is why THAT one has a drift test and this one has a sentence.
"use strict";

/**
 * Stack breadcrumb — pure, zero-dependency logic.
 *
 * A portable port of the `@taskless/stack-breadcrumb` package's core: it derives
 * a stacked-PR forest from `base`/`head` relationships, renders a breadcrumb
 * region, and plans the minimal body edits to keep every PR in a stack pointing
 * at its siblings. There is NO GitHub I/O here — the workflow supplies the PR
 * list (via `actions/github-script`'s octokit) and a `writeBody` callback, so
 * this file needs no npm install, no build step, and stays unit-testable with
 * `node --test`.
 *
 * The two-stage workflow keeps reconciliation serialized per stack root:
 *   stage 1 (dispatch)  — on PR shape events, resolve the affected root(s) and
 *                         fire a `repository_dispatch`.
 *   stage 2 (reconcile) — on that dispatch, render and propagate the breadcrumb.
 */

// ---------------------------------------------------------------------------
// Marker-region parsing
//
// Each managed PR body carries at most one breadcrumb region delimited by
// `<!-- stack root=N pr=… -->` … `<!-- /stack -->`. The helpers here locate and
// parse that region. Placing it in a body — and ordering it against the other
// managed regions — is the job of `canonicalizeBody` (see "Canonical body
// layout" below), which is the single authority on where every region lands.
// ---------------------------------------------------------------------------

/** Matches the whole region, opening marker through `<!-- /stack -->`. */
const REGION_PATTERN = /<!-- stack [^>]*-->[\S\s]*?<!-- \/stack -->/;

/**
 * Matches just the opening marker, capturing `root` and the `pr=` list. Each
 * `pr=` entry is either `member` or `member:parent`, so the character class
 * admits `:` — old flat markers (`pr=82,83,84`) still match and parse as
 * members with no recorded parent (structure then comes from the live graph).
 */
const OPEN_MARKER_PATTERN = /<!-- stack root=(\d+) pr=([\d,:]*) -->/;

/**
 * Parse the opening marker's `root`, ordered `pr=` membership list, and any
 * recorded `member:parent` topology — but only inside a COMPLETE region (both
 * markers present), so a stray or pasted opening marker without its closing tag
 * is not mistaken for a managed region.
 *
 * Returns `{ root, members, parents }` where `parents` is a Map of member →
 * recorded parent for entries that carried a `:parent` suffix. A legacy flat
 * marker yields an empty `parents` map — fully backward compatible.
 */
function parseStackComment(body) {
  const region = getRegion(body);
  if (region === undefined) {
    return undefined;
  }
  const match = OPEN_MARKER_PATTERN.exec(region);
  if (!match) {
    return undefined;
  }
  const root = Number(match[1]);
  const members = [];
  const parents = new Map();
  for (const part of match[2].split(",")) {
    if (part.length === 0) {
      continue;
    }
    const [memberText, parentText] = part.split(":");
    const member = Number(memberText);
    if (!Number.isInteger(member)) {
      continue;
    }
    members.push(member);
    if (parentText !== undefined) {
      const parent = Number(parentText);
      if (Number.isInteger(parent)) {
        parents.set(member, parent);
      }
    }
  }
  return { root, members, parents };
}

/**
 * Consolidate the recorded `member → parent` topology across every PR body in
 * the list. All PRs in a stack carry the same marker, so the union is
 * consistent; on the rare disagreement, last-write wins. Legacy flat markers
 * contribute nothing, so a stack only gains durable topology once it has been
 * reconciled at least once under this format.
 */
function gatherRecordedParents(pullRequests) {
  const parents = new Map();
  for (const pullRequest of pullRequests) {
    const marker = parseStackComment(pullRequest.body);
    if (!marker) {
      continue;
    }
    for (const [member, parent] of marker.parents) {
      parents.set(member, parent);
    }
  }
  return parents;
}

/** Return the existing region (including both markers), or `undefined` if absent. */
function getRegion(body) {
  const match = REGION_PATTERN.exec(body);
  return match ? match[0] : undefined;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HERE_PREFIX = "➡️ "; // ➡️
const HERE_SUFFIX = " (you are here)";
const STACK_HEADING = "**Stack** (root → tip):"; // root → tip

/**
 * Render the full `<!-- stack … -->` … `<!-- /stack -->` region, or `''` for a
 * non-stacked PR.
 *
 * Each node is a BARE `#N`: GitHub's own autolink expands a `#N` reference to
 * the PR's title AND a state icon (open / merged / closed), so adding our own
 * title text or `✅ merged` suffix only DUPLICATES what GitHub already renders.
 * We add only the `➡️ … (you are here)` marker for the current PR, which GitHub
 * cannot know. The `pr=` list still encodes topology as `member:parent` (the
 * root has no `:parent`) so the structure is recorded and survives retargeting.
 */
function renderRegion(tree, currentNumber) {
  if (tree.members.length <= 1) {
    return "";
  }

  const encodeMember = (number_) => {
    const parent = tree.parentOf.get(number_);
    return parent === undefined ? String(number_) : `${number_}:${parent}`;
  };
  const open = `<!-- stack root=${tree.root} pr=${tree.members
    .map(encodeMember)
    .join(",")} -->`;
  const lines = [open, STACK_HEADING, ""];

  // `buildTree` yields an acyclic tree, but guard the recursion defensively so a
  // hand-built or malformed `childrenOf` can never spin the workflow forever.
  const rendered = new Set();
  const renderNode = (number_, depth) => {
    if (rendered.has(number_)) {
      return;
    }
    rendered.add(number_);
    const indent = "  ".repeat(depth);
    const label =
      number_ === currentNumber
        ? `${HERE_PREFIX}#${number_}${HERE_SUFFIX}`
        : `#${number_}`;
    lines.push(`${indent}- ${label}`);
    for (const child of tree.childrenOf.get(number_) ?? []) {
      renderNode(child, depth + 1);
    }
  };

  renderNode(tree.root, 0);
  lines.push("<!-- /stack -->");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PR carry-forward — a merged child's body embedded in its parent
//
// When a stack member merges INTO ITS PARENT (an atomic collapse, tip→root),
// its body is carried into the parent's PR body as a keyed region below the
// stack tree, so the PR that finally lands on the default branch holds the full
// legacy of everything it brings in. Regions are FLAT and keyed by PR number:
// carrying a child also re-homes the child's own carried regions as top-level
// siblings, and every region is upserted (replaced by its key), so the set is
// deduped no matter how many times this runs. Incremental delivery (each PR
// merges straight to the default branch) has no parent PR to carry into, so
// this is a no-op there — correct, since each slice stands alone.
// ---------------------------------------------------------------------------

/** One carried region for a specific PR number (a known key → simple regex). */
function prRegionPattern(number_) {
  return new RegExp(`<!-- PR:${number_} -->[\\S\\s]*?<!-- /PR:${number_} -->`);
}

/** Any carried region; the open/close numbers must agree (backreference). */
const ANY_PR_REGION_PATTERN = /<!-- PR:(\d+) -->[\S\s]*?<!-- \/PR:\1 -->/g;

/** Every carried region already in `body`, in order: `{ number, region }[]`. */
function extractCarriedRegions(body) {
  const regions = [];
  for (const match of body.matchAll(ANY_PR_REGION_PATTERN)) {
    regions.push({ number: Number(match[1]), region: match[0] });
  }
  return regions;
}

/**
 * A body's own description — the human-written part, with the managed regions
 * (the stack tree and any carried `<!-- PR:N -->` regions) removed and the
 * spacing their removal left behind tidied.
 *
 * Only whitespace introduced by the surgery is touched: 3+ newline runs (a seam
 * where a region was cut from the middle) collapse to a blank line, leading
 * blank lines (left when a region sat at the very top) are dropped, and trailing
 * whitespace is trimmed. The prose is otherwise preserved verbatim — crucially,
 * leading indentation on the first line survives, so a description that opens
 * with an indented Markdown code block is not silently reflowed.
 */
function ownDescription(body) {
  return body
    .replace(REGION_PATTERN, "")
    .replace(ANY_PR_REGION_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/**
 * Wrap a description as a carried region for `number_`, headed by `heading`.
 *
 * The heading records HOW this PR joined the body and is fixed at authoring
 * time: a down-merge (tip→root) carries a child into its parent as
 * `Contains #N` (the default); a forward-merge (root→tip) carries a parent into
 * the redirected root as `Built on top of #N`. Re-homing an already-carried
 * region never re-renders it, so its original heading — its provenance —
 * survives regardless of the direction of a later merge.
 */
function renderCarriedRegion(number_, description, heading = "Contains") {
  return [
    `<!-- PR:${number_} -->`,
    `# ${heading} #${number_}`,
    "",
    description,
    `<!-- /PR:${number_} -->`,
  ].join("\n");
}

/**
 * Upsert a carried region into `body` (keyed by PR number): replace an existing
 * region for that number in place, else append it. Final placement (below the
 * breadcrumb and description, sorted by PR number) is settled by
 * `canonicalizeBody`; this helper only guarantees the region is present exactly
 * once. Idempotent.
 */
function upsertCarriedRegion(body, number_, region) {
  const pattern = prRegionPattern(number_);
  if (pattern.test(body)) {
    // Function replacer so `$` sequences in the carried body are literal.
    return body.replace(pattern, () => region);
  }
  const trimmed = body.replace(/\s+$/, "");
  return trimmed.length === 0 ? region : `${trimmed}\n\n${region}`;
}

/**
 * Carry a merged child's body into `parentBody`: add the child's own
 * description as `<!-- PR:child -->`, and re-home the child's already-carried
 * regions as flat top-level siblings — each upserted by key, so the parent ends
 * with a deduped, flat set of every PR in the merged subtree, below the tree.
 *
 * A final `canonicalizeBody` re-lays the accumulated body in the canonical order
 * (breadcrumb → description → carried), keeping the parent's existing
 * breadcrumb. This is convergent with the sync-time reconcile, which both run on
 * a member's merge: whichever writes the parent body last, the result is the
 * same canonical string.
 */
function carryForward(parentBody, childNumber, childBody) {
  let body = upsertCarriedRegion(
    parentBody,
    childNumber,
    renderCarriedRegion(childNumber, ownDescription(childBody))
  );
  for (const { number, region } of extractCarriedRegions(childBody)) {
    body = upsertCarriedRegion(body, number, region);
  }
  return canonicalizeBody(body, getRegion(body) ?? "");
}

/**
 * Carry a merged PARENT's body into `childBody` — the forward-merge (root→tip)
 * mirror of `carryForward`. When a stack lands INCREMENTALLY, the bottom PR
 * merges to the default branch first and the next PR up is retargeted onto the
 * default branch, becoming the new "redirected root". That surviving child
 * absorbs the parent it was built on as `<!-- PR:parent -->` headed
 * `Built on top of #parent`, and re-homes the parent's own already-carried
 * regions as flat top-level siblings — each upserted by key, so the child ends
 * with a deduped, flat set of everything landed beneath it.
 *
 * Where `carryForward` keeps the surviving parent's descendants ("Contains"),
 * `carryBackward` keeps the surviving child's ancestors ("Built on top of"), so
 * the PR that finally reaches the default branch still holds the full legacy of
 * the stack — read from the opposite end. Re-homed regions keep whatever heading
 * they were first carried under (provenance is never rewritten); only the parent
 * being freshly absorbed here is rendered with the forward heading. A final
 * `canonicalizeBody` re-lays the accumulated body in canonical order (breadcrumb
 * → description → carried), keeping the child's existing breadcrumb.
 */
function carryBackward(childBody, parentNumber, parentBody) {
  let body = upsertCarriedRegion(
    childBody,
    parentNumber,
    renderCarriedRegion(
      parentNumber,
      ownDescription(parentBody),
      "Built on top of"
    )
  );
  for (const { number, region } of extractCarriedRegions(parentBody)) {
    body = upsertCarriedRegion(body, number, region);
  }
  return canonicalizeBody(body, getRegion(body) ?? "");
}

// ---------------------------------------------------------------------------
// Canonical body layout
//
// A managed PR body always renders its regions in one fixed order, so a stack
// reads the same on every PR and reformatting is deterministic:
//
//   1. the stack breadcrumb   (<!-- stack … -->)                — on top
//   2. the human description   (everything unmanaged)
//   3. carried-forward legacy  (<!-- PR:N --> blocks, ascending) — on the bottom
//
// `breadcrumb` is the breadcrumb region to place: `''` (or a non-string) omits
// it, so a PR that has left its stack drops the region. The description and any
// carried regions are taken from `body`; carried regions are sorted by PR number
// so the order is stable no matter which order they were carried in. The
// transform is idempotent — a body already in canonical form is returned
// unchanged. As a deliberate exception, a body with NOTHING managed (no
// breadcrumb to place, none present, no carried regions) is returned
// byte-for-byte, so a plain, non-stacked PR's description is never rewritten.
// ---------------------------------------------------------------------------

function canonicalizeBody(body, breadcrumb) {
  const hasBreadcrumb = typeof breadcrumb === "string" && breadcrumb.length > 0;
  const carried = extractCarriedRegions(body).toSorted(
    (a, b) => a.number - b.number
  );
  // Nothing managed to place and nothing already present: leave the body exactly
  // as-is. Only PRs that actually participate in the managed layout get
  // reformatted, so a normal PR's prose (and its incidental whitespace) is safe.
  if (!hasBreadcrumb && carried.length === 0 && getRegion(body) === undefined) {
    return body;
  }
  const description = ownDescription(body);
  const sections = [];
  if (hasBreadcrumb) {
    sections.push(breadcrumb);
  }
  if (description.length > 0) {
    sections.push(description);
  }
  for (const { region } of carried) {
    sections.push(region);
  }
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Tree derivation — additive topology (live edges + recorded parents)
//
// The tree is ADDITIVE: once a PR joins a stack it stays in the breadcrumb, even
// after it merges. Two facts feed the shape:
//
//   1. LIVE parent — the PR whose head branch is this PR's base. This reflects
//      the current GitHub graph and is authoritative: it is not user-editable.
//   2. RECORDED parent — the marker encodes topology as `member:parent`
//      (`pr=82,83:82,84:83`). This is durable: it does not change when a branch
//      is deleted or a PR is retargeted.
//
// The LIVE parent wins. The RECORDED parent is only a fallback for a SEVERED
// edge: when a parent merges, GitHub deletes its branch and retargets the child
// onto the default branch (child.base becomes `main`), so `findRoot` would call
// the child its own root and the merged parent would vanish. In that one case —
// and only when the recorded parent names a KNOWN merged/closed ancestor — the
// recorded link is used, so `buildTree` climbs back to the true root and keeps
// the merged ancestor in the tree. Because PR bodies are user-editable, this
// containment (recorded never overrides a live edge, never attaches a PR under
// an open one) stops a crafted marker from re-parenting an unrelated PR. The
// marker is written while the edges are still live, so the topology is captured
// BEFORE any retarget can sever it.
//
// A legacy flat marker (`pr=82,83,84`) records no parents, so such a stack
// derives purely from the live graph — identical to the pre-topology behavior —
// and self-migrates to the recorded form on its next reconcile.
// ---------------------------------------------------------------------------

function indexPullRequests(pullRequests) {
  const byNumber = new Map();
  const byHead = new Map();
  for (const pullRequest of pullRequests) {
    byNumber.set(pullRequest.number, pullRequest);
    byHead.set(pullRequest.headRefName, pullRequest);
  }
  return { byNumber, byHead };
}

function parentOf(pullRequest, byHead, defaultBranch) {
  if (pullRequest.baseRefName === defaultBranch) {
    return undefined;
  }
  return byHead.get(pullRequest.baseRefName);
}

/** Walk `base` pointers up from `startNumber` to the root of its stack. */
function findRoot(startNumber, pullRequests, defaultBranch) {
  const { byNumber, byHead } = indexPullRequests(pullRequests);
  let current = byNumber.get(startNumber);
  if (!current) {
    return undefined;
  }
  const seen = new Set();
  let parent = parentOf(current, byHead, defaultBranch);
  while (parent && !seen.has(current.number)) {
    seen.add(current.number);
    current = parent;
    parent = parentOf(current, byHead, defaultBranch);
  }
  return current.number;
}

/**
 * Build the provenance tree for `rootNumber`'s stack.
 *
 * Each member's parent is its LIVE parent (the PR whose head branch is this
 * PR's base) when one exists, else its RECORDED parent (from the marker
 * topology) — and the recorded link is used only for a SEVERED edge that names
 * a known merged/closed ancestor. The live edge is authoritative; the recorded
 * parent is the durable fallback that keeps a merged parent (whose child GitHub
 * retargeted onto the default branch) from vanishing. From `rootNumber` we climb
 * to the true (top) root, then DFS down the combined child map, so merged/closed
 * ancestors stay in the tree instead of being pruned.
 *
 * Legacy flat markers record no parents, so a not-yet-migrated stack derives
 * purely from the live graph (unchanged behavior); the first reconcile writes
 * the topology while the edges are still live, making it durable thereafter.
 *
 * Returns `{ root, members, childrenOf, parentOf }` — members in DFS pre-order,
 * `parentOf` a Map of member → parent (the root is absent).
 */
function buildTree(rootNumber, pullRequests) {
  const { byNumber, byHead } = indexPullRequests(pullRequests);
  const recordedParents = gatherRecordedParents(pullRequests);

  const liveParentOf = (number_) => {
    const node = byNumber.get(number_);
    const parent = node ? byHead.get(node.baseRefName) : undefined;
    return parent ? parent.number : undefined;
  };
  // The LIVE edge wins — it is authoritative and not user-editable. A RECORDED
  // parent only fills a SEVERED edge (a PR with no live parent), and only when
  // it points at a KNOWN merged/closed ancestor — the sole legitimate case (a
  // parent that merged and had its child retargeted onto the default branch).
  // PR bodies are user-editable, so this containment stops a crafted marker from
  // re-parenting an unrelated PR: it can neither override a live edge nor attach
  // a PR under an open one.
  const parentOf = (number_) => {
    const live = liveParentOf(number_);
    if (live !== undefined) {
      return live;
    }
    const recorded = recordedParents.get(number_);
    if (recorded === undefined) {
      return undefined;
    }
    const recordedParent = byNumber.get(recorded);
    const parentIsMergedOrClosed =
      recordedParent !== undefined &&
      recordedParent.state !== undefined &&
      recordedParent.state !== "open";
    return parentIsMergedOrClosed ? recorded : undefined;
  };

  // Climb to the true root (recorded topology may point above `rootNumber`
  // once an ancestor has merged and its child was retargeted).
  let trueRoot = rootNumber;
  const climbed = new Set();
  for (
    let parent = parentOf(trueRoot);
    parent !== undefined && !climbed.has(trueRoot);
    parent = parentOf(trueRoot)
  ) {
    climbed.add(trueRoot);
    trueRoot = parent;
  }

  // Every number we know of — live PRs plus any named only by recorded topology
  // (e.g. a merged root that has dropped out of the open-PR list).
  const known = new Set(byNumber.keys());
  for (const [member, parent] of recordedParents) {
    known.add(member);
    known.add(parent);
  }

  // Invert parent → child, then DFS pre-order from the true root.
  const childrenOf = new Map();
  for (const number_ of known) {
    const parent = parentOf(number_);
    if (parent !== undefined && parent !== number_) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), number_]);
    }
  }
  for (const [parent, children] of childrenOf) {
    childrenOf.set(
      parent,
      children.toSorted((a, b) => a - b)
    );
  }

  const members = [];
  const parentMap = new Map();
  const visited = new Set();
  const visit = (number_, parent) => {
    // Guard against a topology cycle: never visit a number twice.
    if (visited.has(number_)) {
      return;
    }
    visited.add(number_);
    members.push(number_);
    if (parent !== undefined) {
      parentMap.set(number_, parent);
    }
    for (const child of childrenOf.get(number_) ?? []) {
      visit(child, number_);
    }
  };
  visit(trueRoot, undefined);

  // Scope the child map to this tree's members, guaranteeing an entry (possibly
  // empty) for every member — including leaves.
  const scopedChildren = new Map();
  for (const number_ of members) {
    scopedChildren.set(number_, childrenOf.get(number_) ?? []);
  }

  return {
    root: trueRoot,
    members,
    childrenOf: scopedChildren,
    parentOf: parentMap,
  };
}

/** Find the root of `triggerNumber`'s stack, then build the tree. */
function resolveTree(triggerNumber, pullRequests, defaultBranch) {
  const root = findRoot(triggerNumber, pullRequests, defaultBranch);
  if (root === undefined) {
    return undefined;
  }
  return buildTree(root, pullRequests);
}

/**
 * Resolve the root(s) of the stack(s) a PR event affects.
 * - An OPEN trigger affects exactly its own root.
 * - A CLOSED/merged trigger's stack still needs a redraw: union the survivors
 *   found via the parent route (open PR headed at the closed PR's base) and the
 *   marker route (open PRs whose last breadcrumb listed the closed PR), then map
 *   each surviving member to its (possibly new) root.
 */
function resolveAffectedRoots(trigger, pullRequests, defaultBranch) {
  const isOpen = pullRequests.some(
    (pullRequest) => pullRequest.number === trigger.number
  );
  if (isOpen) {
    const root = findRoot(trigger.number, pullRequests, defaultBranch);
    return root === undefined ? [] : [root];
  }

  const affected = new Set();
  for (const candidate of pullRequests) {
    const isParentOfClosed = candidate.headRefName === trigger.baseRefName;
    const marker = parseStackComment(candidate.body);
    const markerNamedClosed =
      marker !== undefined &&
      (marker.root === trigger.number ||
        marker.members.includes(trigger.number));
    if (isParentOfClosed || markerNamedClosed) {
      affected.add(candidate.number);
    }
  }

  const roots = new Set();
  for (const number_ of affected) {
    const root = findRoot(number_, pullRequests, defaultBranch);
    if (root !== undefined) {
      roots.add(root);
    }
  }
  return [...roots].toSorted((a, b) => a - b);
}

/** Every distinct stack root among the open PRs (deduped, ascending). */
function findAllRoots(pullRequests, defaultBranch) {
  const roots = new Set();
  for (const pullRequest of pullRequests) {
    const root = findRoot(pullRequest.number, pullRequests, defaultBranch);
    if (root !== undefined) {
      roots.add(root);
    }
  }
  return [...roots].toSorted((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Reconcile orchestration
// ---------------------------------------------------------------------------

/**
 * Compute the new body for one PR given its desired breadcrumb region (`''`
 * removes it). The body is re-laid in canonical order (breadcrumb → description
 * → carried), so a sync also normalizes the layout of an existing PR — the one
 * moment the region order matters.
 */
function planUpdate(pullRequest, region) {
  const body = canonicalizeBody(pullRequest.body, region);
  return {
    number: pullRequest.number,
    changed: body !== pullRequest.body,
    body,
  };
}

/**
 * Reconcile the tree rooted at `root`: render the breadcrumb for each member and
 * write only changed bodies via `deps.writeBody`. A write that throws is logged
 * and the PR is recorded as failed; the rest of the tree still reconciles.
 */
async function reconcile(root, deps) {
  const { pullRequests, writeBody } = deps;
  const byNumber = new Map(
    pullRequests.map((pullRequest) => [pullRequest.number, pullRequest])
  );
  const tree = buildTree(root, pullRequests);

  const updated = [];
  const skipped = [];
  const frozen = [];
  const failed = [];

  for (const number_ of tree.members) {
    const pullRequest = byNumber.get(number_);
    if (!pullRequest) {
      continue;
    }
    // A merged/closed member stays in the tree — so open PRs keep listing it and
    // the last open PR captures the full construction history — but its own body
    // is frozen (never rewritten). Members without a `state` are treated as open
    // (open-PR list and unit fixtures both omit or set it to "open").
    if (pullRequest.state !== undefined && pullRequest.state !== "open") {
      frozen.push(number_);
      continue;
    }
    const region = renderRegion(tree, number_);
    const plan = planUpdate(pullRequest, region);
    if (!plan.changed) {
      skipped.push(number_);
      continue;
    }
    try {
      await writeBody(number_, plan.body);
      updated.push(number_);
    } catch (error) {
      console.error(
        `stack-breadcrumb: could not update PR #${number_}: ${String(error)}`
      );
      failed.push(number_);
    }
  }

  return { root, updated, skipped, frozen, failed };
}

// ---------------------------------------------------------------------------
// Stale stack-check detection (for re-running "trued" checks)
// ---------------------------------------------------------------------------

/**
 * Given a workflow run's `jobs`, decide whether that run is a stale
 * stack-dependent check to re-run: it qualifies when one of its jobs FAILED and
 * that job's name is `stack`-prefixed (the convention for stack-position-
 * dependent gates, e.g. `stack: openspec-archived`). Passing/skipped stack jobs
 * and non-stack failures (tests) do NOT qualify — so nothing is re-run when the
 * stack is mid-flight and its checks are green or appropriately skipped.
 */
function hasFailedStackJob(jobs) {
  return (jobs ?? []).some(
    (job) =>
      job.conclusion === "failure" && /^stack\b/i.test(String(job.name ?? ""))
  );
}

module.exports = {
  parseStackComment,
  gatherRecordedParents,
  getRegion,
  canonicalizeBody,
  renderRegion,
  findRoot,
  buildTree,
  resolveTree,
  resolveAffectedRoots,
  findAllRoots,
  planUpdate,
  reconcile,
  hasFailedStackJob,
  extractCarriedRegions,
  ownDescription,
  upsertCarriedRegion,
  carryForward,
  carryBackward,
  HERE_PREFIX,
  HERE_SUFFIX,
  STACK_HEADING,
};
