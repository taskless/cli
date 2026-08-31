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

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("./stack-breadcrumb.cjs");

const DEFAULT_BRANCH = "main";

function pr(number, head, base, body = "") {
  return {
    number,
    title: `PR ${number}`,
    headRefName: head,
    baseRefName: base,
    body,
  };
}

const REGION = [
  "<!-- stack root=10 pr=10,11:10,12:11 -->",
  "**Stack** (root → tip):",
  "",
  "- #10",
  "  - ➡️ #11 (you are here)",
  "    - #12",
  "<!-- /stack -->",
].join("\n");

test("parseStackComment: parses root, membership, and recorded topology", () => {
  assert.deepEqual(parseStackComment(`intro\n\n${REGION}`), {
    root: 10,
    members: [10, 11, 12],
    parents: new Map([
      [11, 10],
      [12, 11],
    ]),
  });
});

test("parseStackComment: a legacy flat marker yields no recorded parents", () => {
  assert.deepEqual(
    parseStackComment("<!-- stack root=10 pr=10,11,12 -->\nx\n<!-- /stack -->"),
    { root: 10, members: [10, 11, 12], parents: new Map() }
  );
});

test("parseStackComment: parses an empty membership list", () => {
  assert.deepEqual(
    parseStackComment("<!-- stack root=10 pr= -->\nx\n<!-- /stack -->"),
    { root: 10, members: [], parents: new Map() }
  );
});

test("gatherRecordedParents: consolidates topology across bodies", () => {
  const region = "<!-- stack root=10 pr=10,11:10,12:11 -->\nx\n<!-- /stack -->";
  const prs = [
    pr(11, "b", "main", region),
    pr(12, "c", "b", region),
    pr(20, "x", "main", "no marker here"),
  ];
  assert.deepEqual(
    [...gatherRecordedParents(prs)],
    [
      [11, 10],
      [12, 11],
    ]
  );
});

test("parseStackComment: undefined when no marker", () => {
  assert.equal(parseStackComment("just a normal PR body"), undefined);
});

test("parseStackComment: undefined for a bare opening marker without a closing tag", () => {
  // A pasted/stray opening marker must not be treated as a managed region.
  assert.equal(
    parseStackComment("intro\n<!-- stack root=10 pr=10,11 -->\nno closing tag"),
    undefined
  );
});

test("getRegion: extracts the full region", () => {
  assert.equal(getRegion(`before\n${REGION}\nafter`), REGION);
});

test("getRegion: undefined when absent", () => {
  assert.equal(getRegion("no region here"), undefined);
});

// A carried-forward legacy region, used by the canonical-layout tests below.
const CARRIED_84 = [
  "<!-- PR:84 -->",
  "# Contains #84",
  "",
  "Group 84 work.",
  "<!-- /PR:84 -->",
].join("\n");
const CARRIED_85 = [
  "<!-- PR:85 -->",
  "# Contains #85",
  "",
  "Tip work.",
  "<!-- /PR:85 -->",
].join("\n");

test("canonicalizeBody: orders breadcrumb → description → carried", () => {
  assert.equal(
    canonicalizeBody("Original body.", REGION),
    `${REGION}\n\nOriginal body.`
  );
});

test("canonicalizeBody: returns just the breadcrumb for an empty body", () => {
  assert.equal(canonicalizeBody("", REGION), REGION);
});

test("canonicalizeBody: reflows an out-of-order body into canonical order", () => {
  // Worst case: carried region first, then description, then the breadcrumb.
  const body = `${CARRIED_85}\n\nMy description.\n\n${REGION}`;
  assert.equal(
    canonicalizeBody(body, REGION),
    `${REGION}\n\nMy description.\n\n${CARRIED_85}`
  );
});

test("canonicalizeBody: sorts carried regions ascending by PR number", () => {
  // #85 appears before #84 in the input; canonical order sorts them 84, 85.
  const body = `Desc.\n\n${CARRIED_85}\n\n${CARRIED_84}\n\n${REGION}`;
  assert.equal(
    canonicalizeBody(body, REGION),
    `${REGION}\n\nDesc.\n\n${CARRIED_84}\n\n${CARRIED_85}`
  );
});

test("canonicalizeBody: is idempotent on an already-canonical body", () => {
  const canonical = `${REGION}\n\nDesc.\n\n${CARRIED_84}`;
  assert.equal(canonicalizeBody(canonical, REGION), canonical);
});

test("canonicalizeBody: empty breadcrumb drops the stack region", () => {
  assert.equal(canonicalizeBody(`keep this\n\n${REGION}`, ""), "keep this");
});

test("canonicalizeBody: leaves a plain non-stacked body byte-for-byte", () => {
  // No breadcrumb to place, none present, no carried regions → untouched, even
  // with incidental trailing whitespace and blank runs a reformat would tidy.
  const body = "just a normal PR\n\n\n\nwith odd spacing\n";
  assert.equal(canonicalizeBody(body, ""), body);
});

test("canonicalizeBody: keeps carried legacy even with no breadcrumb", () => {
  // A collapsed root that has left its stack but still holds carried history.
  assert.equal(
    canonicalizeBody(`Desc.\n\n${CARRIED_84}`, ""),
    `Desc.\n\n${CARRIED_84}`
  );
});

test("canonicalizeBody: does not treat $ sequences as replacement patterns", () => {
  const dollarRegion =
    "<!-- stack root=10 pr=10,11 -->\ncost is $1 and $& too\n<!-- /stack -->";
  const body = "<!-- stack root=10 pr=10 -->\nold\n<!-- /stack -->";
  assert.equal(canonicalizeBody(body, dollarRegion), dollarRegion);
});

const chain = [pr(10, "a", DEFAULT_BRANCH), pr(11, "b", "a"), pr(12, "c", "b")];
const branching = [
  pr(10, "a", DEFAULT_BRANCH),
  pr(11, "b", "a"),
  pr(12, "c", "a"),
  pr(13, "d", "b"),
];

test("renderRegion: nested list with current PR marked", () => {
  assert.equal(renderRegion(buildTree(10, chain), 11), REGION);
});

test("renderRegion: empty for a non-stacked single-member tree", () => {
  assert.equal(renderRegion(buildTree(10, [pr(10, "a", "main")]), 10), "");
});

test("findRoot: walks a chain up to the root", () => {
  assert.equal(findRoot(12, chain, DEFAULT_BRANCH), 10);
  assert.equal(findRoot(11, chain, DEFAULT_BRANCH), 10);
  assert.equal(findRoot(10, chain, DEFAULT_BRANCH), 10);
});

test("findRoot: resolves from any branch of a branching tree", () => {
  assert.equal(findRoot(13, branching, DEFAULT_BRANCH), 10);
  assert.equal(findRoot(12, branching, DEFAULT_BRANCH), 10);
});

test("findRoot: a PR whose base has no open PR is its own root", () => {
  assert.equal(
    findRoot(11, [pr(11, "b", "deleted-parent")], DEFAULT_BRANCH),
    11
  );
});

test("findRoot: undefined for a PR that is not open", () => {
  assert.equal(findRoot(99, chain, DEFAULT_BRANCH), undefined);
});

test("buildTree: DFS pre-order for a chain", () => {
  assert.deepEqual(buildTree(10, chain).members, [10, 11, 12]);
});

test("buildTree: DFS pre-order with sorted children for a branching tree", () => {
  assert.deepEqual(buildTree(10, branching).members, [10, 11, 13, 12]);
});

test("buildTree: records sorted children per node", () => {
  const tree = buildTree(10, branching);
  assert.deepEqual(tree.childrenOf.get(10), [11, 12]);
  assert.deepEqual(tree.childrenOf.get(11), [13]);
  assert.deepEqual(tree.childrenOf.get(13), []);
});

test("buildTree: terminates on a base/head cycle, visiting each once", () => {
  const cycle = [pr(10, "a", "b"), pr(11, "b", "a")];
  assert.deepEqual(buildTree(10, cycle).members, [10, 11]);
});

test("resolveTree: finds root and builds tree in one step", () => {
  const tree = resolveTree(12, chain, DEFAULT_BRANCH);
  assert.equal(tree.root, 10);
  assert.deepEqual(tree.members, [10, 11, 12]);
});

test("resolveTree: undefined when the trigger is not open", () => {
  assert.equal(resolveTree(99, chain, DEFAULT_BRANCH), undefined);
});

test("findAllRoots: each distinct root once, ascending", () => {
  const twoStacks = [...chain, pr(20, "x", DEFAULT_BRANCH), pr(21, "y", "x")];
  assert.deepEqual(findAllRoots(twoStacks, DEFAULT_BRANCH), [10, 20]);
});

test("findAllRoots: empty when there are no open PRs", () => {
  assert.deepEqual(findAllRoots([], DEFAULT_BRANCH), []);
});

test("resolveAffectedRoots: open trigger returns its own root", () => {
  assert.deepEqual(
    resolveAffectedRoots(
      { number: 12, baseRefName: "b" },
      chain,
      DEFAULT_BRANCH
    ),
    [10]
  );
});

test("resolveAffectedRoots: parent route when a leaf closes", () => {
  const open = [pr(10, "a", DEFAULT_BRANCH), pr(11, "b", "a")];
  assert.deepEqual(
    resolveAffectedRoots(
      { number: 12, baseRefName: "b" },
      open,
      DEFAULT_BRANCH
    ),
    [10]
  );
});

test("resolveAffectedRoots: marker route when the root merges and children retarget", () => {
  const marker = "<!-- stack root=10 pr=10,11,12 -->\nx\n<!-- /stack -->";
  const open = [pr(11, "b", DEFAULT_BRANCH, marker), pr(12, "c", "b", marker)];
  assert.deepEqual(
    resolveAffectedRoots(
      { number: 10, baseRefName: DEFAULT_BRANCH },
      open,
      DEFAULT_BRANCH
    ),
    [11]
  );
});

test("resolveAffectedRoots: nothing when a closed PR affects no open stack", () => {
  assert.deepEqual(
    resolveAffectedRoots(
      { number: 99, baseRefName: "gone" },
      [pr(10, "a", DEFAULT_BRANCH)],
      DEFAULT_BRANCH
    ),
    []
  );
});

test("planUpdate: places the breadcrumb above the description and flags a change", () => {
  const plan = planUpdate(pr(10, "a", "main", "intro"), REGION);
  assert.equal(plan.changed, true);
  assert.equal(plan.body, `${REGION}\n\nintro`);
});

test("planUpdate: reflows a description-first body to canonical order", () => {
  // An existing PR authored with the breadcrumb below the prose is reformatted
  // on sync — the one moment the region order matters.
  const plan = planUpdate(pr(10, "a", "main", `intro\n\n${REGION}`), REGION);
  assert.equal(plan.changed, true);
  assert.equal(plan.body, `${REGION}\n\nintro`);
});

test("planUpdate: skips when the body is already canonical", () => {
  const plan = planUpdate(pr(10, "a", "main", `${REGION}\n\nintro`), REGION);
  assert.equal(plan.changed, false);
});

test("planUpdate: removes the region when the desired region is empty", () => {
  const plan = planUpdate(pr(10, "a", "main", `x\n\n${REGION}`), "");
  assert.equal(plan.changed, true);
  assert.ok(!plan.body.includes("<!-- stack"));
});

test("reconcile: writes only changed bodies and reports updated/skipped", async () => {
  const twoChain = [pr(10, "a", "main"), pr(11, "b", "a")];
  const calls = [];
  const result = await reconcile(10, {
    pullRequests: twoChain,
    writeBody: (number_, body) => calls.push([number_, body]),
  });
  assert.equal(result.root, 10);
  assert.deepEqual(result.updated, [10, 11]);
  assert.deepEqual(result.skipped, []);
  assert.equal(calls.length, 2);
});

test("reconcile: skips a PR whose body already matches", async () => {
  const twoChain = [pr(10, "a", "main"), pr(11, "b", "a")];
  const tree = buildTree(10, twoChain);
  // Seed with the same render reconcile produces, so the body matches → skipped.
  const seeded = twoChain.map((p) =>
    p.number === 10 ? { ...p, body: renderRegion(tree, 10) } : p
  );
  const result = await reconcile(10, { pullRequests: seeded, writeBody() {} });
  assert.ok(result.skipped.includes(10));
  assert.ok(result.updated.includes(11));
});

test("reconcile: records a failed write and continues", async () => {
  const twoChain = [pr(10, "a", "main"), pr(11, "b", "a")];
  const result = await reconcile(10, {
    pullRequests: twoChain,
    writeBody(number_) {
      if (number_ === 10) throw new Error("forbidden");
    },
  });
  assert.deepEqual(result.failed, [10]);
  assert.deepEqual(result.updated, [11]);
});

test("reconcile: freezes a merged member but keeps it in the open PR's breadcrumb", async () => {
  // #10 open (root), #11 merged (tip). #11 stays in the tree so #10 keeps
  // listing it, but its own body is never rewritten.
  const prs = [
    { ...pr(10, "a", "main"), state: "open" },
    { ...pr(11, "b", "a"), state: "closed" },
  ];
  const calls = [];
  const result = await reconcile(10, {
    pullRequests: prs,
    writeBody: (number_, body) => calls.push([number_, body]),
  });
  assert.deepEqual(result.updated, [10]);
  assert.deepEqual(result.frozen, [11]);
  assert.equal(calls.length, 1);
  // #10's breadcrumb still lists the merged #11 and the marker keeps full membership.
  assert.match(calls[0][1], /#11/);
  assert.match(calls[0][1], /pr=10,11/);
});

test("reconcile: a lone open root with only merged descendants still renders", async () => {
  // The whole stack has merged except the root — the breadcrumb must NOT clear,
  // and the merged descendants stay listed with a merged marker.
  const prs = [
    { ...pr(10, "a", "main"), state: "open" },
    { ...pr(11, "b", "a"), state: "closed", merged: true },
    { ...pr(12, "c", "b"), state: "closed", merged: true },
  ];
  const calls = [];
  const result = await reconcile(10, {
    pullRequests: prs,
    writeBody: (number_, body) => calls.push([number_, body]),
  });
  assert.deepEqual(result.updated, [10]);
  assert.deepEqual(result.frozen, [11, 12]);
  assert.match(calls[0][1], /pr=10,11:10,12:11/);
  assert.match(calls[0][1], /- #11\b/); // merged member still listed
  assert.match(calls[0][1], /- #12\b/);
});

test("renderRegion: renders bare #N refs and encodes topology (no title/status)", () => {
  // GitHub autolinks a #N reference to the PR title + a state icon, so the tree
  // stays bare — no appended title, no ✅/⛔ suffix — while the marker still
  // records `member:parent` topology.
  const region = renderRegion(buildTree(10, chain), 10);
  assert.match(region, /pr=10,11:10,12:11/);
  assert.match(region, /- ➡️ #10 \(you are here\)/);
  assert.match(region, /- #11\n/);
  assert.match(region, /- #12/);
  assert.doesNotMatch(region, /✅|⛔|merged|closed/);
});

test("buildTree: keeps a merged root after its child was retargeted", () => {
  // #10 merged (root, branch a); #11 open but GitHub retargeted its base to
  // main when #10 merged — the live base/head edge #10→#11 is gone. The
  // recorded topology (member:parent) restores it, so #10 stays the root.
  const marker = "<!-- stack root=10 pr=10,11:10,12:11 -->\nx\n<!-- /stack -->";
  const prs = [
    { ...pr(10, "a", DEFAULT_BRANCH, marker), state: "closed", merged: true },
    { ...pr(11, "b", DEFAULT_BRANCH, marker), state: "open" }, // retargeted to main
    { ...pr(12, "c", "b", marker), state: "open" },
  ];
  // The dispatched root is the live root #11; buildTree climbs to #10.
  const tree = buildTree(11, prs);
  assert.equal(tree.root, 10);
  assert.deepEqual(tree.members, [10, 11, 12]);
  assert.equal(tree.parentOf.get(11), 10);
  assert.equal(tree.parentOf.get(12), 11);
});

test("buildTree: a crafted marker cannot re-parent a PR under an open one", () => {
  // A hand-edited body claims open #50 is a child of open #99. #50 has no live
  // parent (base=main), but the recorded parent is OPEN, so it is NOT honored —
  // #50 stays its own root instead of being hijacked into #99's tree.
  const crafted = "<!-- stack root=99 pr=99,50:99 -->\nx\n<!-- /stack -->";
  const prs = [
    { ...pr(99, "x", DEFAULT_BRANCH, crafted), state: "open" },
    { ...pr(50, "y", DEFAULT_BRANCH, crafted), state: "open" },
  ];
  const tree = buildTree(50, prs);
  assert.equal(tree.root, 50);
  assert.deepEqual(tree.members, [50]);
});

test("buildTree: a recorded parent never overrides a live edge", () => {
  // #11 has a live parent (#10 via base "a"); a body claiming a different
  // recorded parent must not win over the authoritative live edge.
  const lie = "<!-- stack root=99 pr=11:99 -->\nx\n<!-- /stack -->";
  const prs = [
    { ...pr(10, "a", DEFAULT_BRANCH), state: "open" },
    { ...pr(11, "b", "a", lie), state: "open" },
  ];
  const tree = buildTree(10, prs);
  assert.equal(tree.root, 10);
  assert.equal(tree.parentOf.get(11), 10);
});

test("renderRegion: terminates on a malformed cyclic childrenOf", () => {
  // Defensive: a hand-built cyclic tree must not spin forever.
  const cyclic = {
    root: 1,
    members: [1, 2],
    parentOf: new Map([[2, 1]]),
    childrenOf: new Map([
      [1, [2]],
      [2, [1]], // cycle back to the root
    ]),
  };
  const region = renderRegion(cyclic, 1);
  assert.match(region, /#1/);
  assert.match(region, /#2/);
});

test("reconcile: keeps a merged, retargeted-away root in the open breadcrumbs", async () => {
  const marker = "<!-- stack root=10 pr=10,11:10,12:11 -->\nx\n<!-- /stack -->";
  const prs = [
    { ...pr(10, "a", DEFAULT_BRANCH, marker), state: "closed", merged: true },
    { ...pr(11, "b", DEFAULT_BRANCH, marker), state: "open" },
    { ...pr(12, "c", "b", marker), state: "open" },
  ];
  const calls = [];
  const result = await reconcile(11, {
    pullRequests: prs,
    writeBody: (number_, body) => calls.push([number_, body]),
  });
  assert.deepEqual(result.frozen, [10]); // merged root never rewritten
  assert.deepEqual(
    result.updated.toSorted((a, b) => a - b),
    [11, 12]
  );
  const body11 = calls.find(([number_]) => number_ === 11)[1];
  assert.match(body11, /- #10\b/); // merged root still listed (provenance kept)
  assert.match(body11, /pr=10,11:10,12:11/); // topology recorded forward
});

test("hasFailedStackJob: true when a stack-prefixed job failed", () => {
  assert.equal(
    hasFailedStackJob([
      { name: "stack: position", conclusion: "success" },
      { name: "stack: openspec-archived", conclusion: "failure" },
    ]),
    true
  );
});

test("hasFailedStackJob: false when the only failure is not a stack job", () => {
  assert.equal(
    hasFailedStackJob([
      { name: "stack: position", conclusion: "success" },
      { name: "Validate", conclusion: "failure" },
    ]),
    false
  );
});

test("hasFailedStackJob: false for a skipped stack job (not a failure)", () => {
  assert.equal(
    hasFailedStackJob([
      { name: "stack: openspec-archived", conclusion: "skipped" },
    ]),
    false
  );
});

test("hasFailedStackJob: 'stack' must be a name prefix, not merely contained", () => {
  assert.equal(
    hasFailedStackJob([
      { name: "Reconcile breadcrumb across the stack", conclusion: "failure" },
    ]),
    false
  );
});

test("hasFailedStackJob: false for empty/missing jobs", () => {
  assert.equal(hasFailedStackJob([]), false);
  assert.equal(hasFailedStackJob(undefined), false);
});

// ─── Titles in the tree ──────────────────────────────────────────────────────

// ─── PR carry-forward ────────────────────────────────────────────────────────

const P85 = [
  "<!-- PR:85 -->",
  "# Contains #85",
  "",
  "Tip work.",
  "<!-- /PR:85 -->",
].join("\n");

test("extractCarriedRegions: finds each carried region with its number", () => {
  const body = `intro\n\n${P85}\n\n<!-- PR:84 -->\n# Contains #84\nx\n<!-- /PR:84 -->`;
  assert.deepEqual(
    extractCarriedRegions(body).map((r) => r.number),
    [85, 84]
  );
});

test("ownDescription: strips the stack tree and carried regions", () => {
  const body = [
    "My description.",
    "",
    "<!-- stack root=82 pr=82,83:82 -->\n(tree)\n<!-- /stack -->",
    "",
    P85,
  ].join("\n");
  assert.equal(ownDescription(body), "My description.");
});

test("ownDescription: preserves leading indentation after a top region", () => {
  // A breadcrumb at the very top must not cost the prose its leading indent —
  // otherwise a description opening with an indented code block gets reflowed.
  const body =
    "<!-- stack root=1 pr=1,2:1 -->\n(tree)\n<!-- /stack -->\n\n    const x = 1;\nplain line";
  assert.equal(ownDescription(body), "    const x = 1;\nplain line");
});

test("upsertCarriedRegion: appends when absent, replaces in place when present", () => {
  const appended = upsertCarriedRegion("Body.", 85, P85);
  assert.equal(appended, `Body.\n\n${P85}`);

  const replacement = P85.replace("Tip work.", "Revised.");
  const replaced = upsertCarriedRegion(appended, 85, replacement);
  assert.match(replaced, /Revised\./);
  assert.doesNotMatch(replaced, /Tip work\./);
  // Still exactly one region for #85 (no duplication).
  assert.equal(extractCarriedRegions(replaced).length, 1);
});

test("carryForward: flattens the merged subtree into the parent below the tree", () => {
  // #84 already carries #85; merging #84 into #83 lands both, flat.
  const parent83 =
    "Parent 83 desc.\n\n<!-- stack root=82 pr=82,83:82,84:83,85:84 -->\n(tree)\n<!-- /stack -->";
  const child84 = [
    "Group 84 work.",
    "",
    "<!-- stack root=82 pr=82,83:82,84:83,85:84 -->\n(tree)\n<!-- /stack -->",
    "",
    P85,
  ].join("\n");

  const result = carryForward(parent83, 84, child84);

  const carried = extractCarriedRegions(result);
  assert.deepEqual(
    carried.map((r) => r.number),
    [84, 85]
  );
  // #84's region is its OWN description only (tree + #85 stripped out).
  assert.match(
    result,
    /<!-- PR:84 -->\n# Contains #84\n\nGroup 84 work\.\n<!-- \/PR:84 -->/
  );
  // #85 re-homed verbatim as a flat sibling.
  assert.ok(result.includes(P85));
  // Carried regions sit below the tree.
  assert.ok(
    result.indexOf("<!-- /stack -->") < result.indexOf("<!-- PR:84 -->")
  );
});

test("carryForward: is idempotent — re-carrying does not duplicate", () => {
  const parent =
    "Parent.\n\n<!-- stack root=1 pr=1,2:1 -->\n(t)\n<!-- /stack -->";
  const child = "Child work.";
  const once = carryForward(parent, 2, child);
  const twice = carryForward(once, 2, child);
  assert.equal(once, twice);
  assert.equal(extractCarriedRegions(twice).length, 1);
});

test("carryForward: emits canonical order — breadcrumb, then description, then carried", () => {
  // Parent authored description-first; carrying a child must hoist the
  // breadcrumb above the prose, matching the sync-time layout so the two
  // converge no matter which writes the parent body last.
  const breadcrumb =
    "<!-- stack root=82 pr=82,83:82,84:83 -->\n(tree)\n<!-- /stack -->";
  const parent83 = `Parent 83 desc.\n\n${breadcrumb}`;
  const result = carryForward(parent83, 84, "Group 84 work.");
  assert.equal(
    result,
    `${breadcrumb}\n\nParent 83 desc.\n\n<!-- PR:84 -->\n# Contains #84\n\nGroup 84 work.\n<!-- /PR:84 -->`
  );
});

// ─── PR carry-backward (forward-merge, root→tip) ─────────────────────────────

test("carryBackward: absorbs the merged parent under a 'Built on top of' heading", () => {
  // #82 (the root) merged to the default branch; #83 is retargeted onto it and
  // becomes the redirected root, absorbing #82.
  const child83 =
    "Group 83 work.\n\n<!-- stack root=82 pr=82,83:82 -->\n(tree)\n<!-- /stack -->";
  const result = carryBackward(child83, 82, "Root 82 desc.");
  assert.match(
    result,
    /<!-- PR:82 -->\n# Built on top of #82\n\nRoot 82 desc\.\n<!-- \/PR:82 -->/
  );
});

test("carryBackward: re-homes the merged parent's carried regions, keeping their headings", () => {
  // #82 already carried #81 downward ("Contains"); when #82 merges forward into
  // #83, #81 rides along as a flat sibling and KEEPS its original heading —
  // provenance is never rewritten by the direction of a later merge.
  const carried81 = [
    "<!-- PR:81 -->",
    "# Contains #81",
    "",
    "Earlier work.",
    "<!-- /PR:81 -->",
  ].join("\n");
  const parent82 = `Root 82 desc.\n\n${carried81}`;
  const child83 =
    "Group 83 work.\n\n<!-- stack root=82 pr=82,83:82 -->\n(tree)\n<!-- /stack -->";

  const result = carryBackward(child83, 82, parent82);

  // Both ancestors are present, sorted by number below the tree.
  assert.deepEqual(
    extractCarriedRegions(result).map((r) => r.number),
    [81, 82]
  );
  // #82 is freshly absorbed with the forward heading …
  assert.match(result, /# Built on top of #82/);
  // … while #81 rides along with the heading it was first carried under.
  assert.ok(result.includes(carried81));
});

test("carryBackward: is idempotent — re-absorbing does not duplicate", () => {
  const child =
    "Child work.\n\n<!-- stack root=1 pr=1,2:1 -->\n(t)\n<!-- /stack -->";
  const once = carryBackward(child, 1, "Root work.");
  const twice = carryBackward(once, 1, "Root work.");
  assert.equal(once, twice);
  assert.equal(extractCarriedRegions(twice).length, 1);
});

test("carryBackward: emits canonical order — breadcrumb, then description, then carried", () => {
  const breadcrumb =
    "<!-- stack root=82 pr=82,83:82 -->\n(tree)\n<!-- /stack -->";
  // Child authored description-first; absorbing the parent must still land the
  // breadcrumb on top, the child's prose next, and the carried parent last.
  const child83 = `Group 83 work.\n\n${breadcrumb}`;
  const result = carryBackward(child83, 82, "Root 82 desc.");
  assert.equal(
    result,
    `${breadcrumb}\n\nGroup 83 work.\n\n<!-- PR:82 -->\n# Built on top of #82\n\nRoot 82 desc.\n<!-- /PR:82 -->`
  );
});
