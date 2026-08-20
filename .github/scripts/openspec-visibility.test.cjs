// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for openspec-visibility.cjs — the check that catches requirements the
 * OpenSpec parser stops reading, rather than requirements it reads and rejects.
 *
 * Most cases run the counter over an inline spec string; the two that exercise
 * main() build a throwaway spec tree in a temp directory, so nothing here reads
 * or depends on the committed specs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  countRequirements,
  checkSpecs,
  main,
} = require("./openspec-visibility.cjs");

const CLEAN_SPEC = [
  "# capability Specification",
  "",
  "## Purpose",
  "",
  "Why this capability exists.",
  "",
  "## Requirements",
  "",
  "### Requirement: First thing",
  "",
  "The system SHALL do the first thing.",
  "",
  "#### Scenario: It happens",
  "",
  "- **WHEN** asked",
  "- **THEN** it happens",
  "",
  "### Requirement: Second thing",
  "",
  "The system SHALL do the second thing.",
  "",
  "#### Scenario: It also happens",
  "",
  "- **WHEN** asked",
  "- **THEN** it also happens",
  "",
].join("\n");

/** The clean spec with a stray `## Grouping` inserted before the second requirement. */
const TRUNCATED_SPEC = CLEAN_SPEC.replace(
  "### Requirement: Second thing",
  "## Grouping\n\n### Requirement: Second thing"
);

test("a clean spec has every requirement visible", () => {
  assert.deepEqual(countRequirements(CLEAN_SPEC), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("a stray '##' heading hides every requirement below it", () => {
  assert.deepEqual(countRequirements(TRUNCATED_SPEC), {
    total: 2,
    visible: 1,
    hidden: 1,
    unclosedFence: false,
  });
});

test("a tab after '##' ends the section, matching OpenSpec's '\\s'", () => {
  // OpenSpec matches /^##\s+/, not a literal "## ", so `##\tGrouping` is a real
  // heading that truncates the section. Requiring a space here would report
  // those requirements visible while the parser never reads them.
  const tabHeading = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "##\tGrouping\n\n### Requirement: Second thing"
  );
  assert.deepEqual(countRequirements(tabHeading), {
    total: 2,
    visible: 1,
    hidden: 1,
    unclosedFence: false,
  });
});

test("a '#' heading ends the section, matching the parser's level rule", () => {
  // getContentUntilNextHeader(startLine, 2) breaks on any heading of level <= 2,
  // so a level-1 heading truncates `## Requirements` exactly as a `##` does.
  // Verified against MarkdownParser: it reads 1 requirement from this source.
  const levelOneHeading = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "# Interlude\n\n### Requirement: Second thing"
  );
  assert.deepEqual(countRequirements(levelOneHeading), {
    total: 2,
    visible: 1,
    hidden: 1,
    unclosedFence: false,
  });
});

test("a title-less '### Requirement:' still counts", () => {
  // parseRequirements promotes every `###` child of the section regardless of
  // its title, so MarkdownParser reads this as a requirement (verified). The
  // stricter /^###\s*Requirement:\s*(.+)\s*$/ in requirement-blocks.js governs
  // the delta/edit path, not validation — following it here would stop counting
  // a heading the validating parser does read.
  const titleless = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "### Requirement:"
  );
  assert.deepEqual(countRequirements(titleless), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("an indented '##' is prose, not a section boundary", () => {
  // CommonMark allows up to three spaces before an ATX heading; OpenSpec's
  // parsers are all anchored at column 0 and do not. Widening this check to
  // /^ {0,3}##/ would report a requirement hidden that the parser reads fine.
  const indentedHeading = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "   ## Grouping\n\n### Requirement: Second thing"
  );
  assert.deepEqual(countRequirements(indentedHeading), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("'### Requirement:' spacing is as loose as OpenSpec's", () => {
  // REQUIREMENT_HEADER_REGEX is /^###\s*Requirement:/ — no space and several
  // spaces both parse, so both must count toward the total.
  const looseSpacing = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "###Requirement: Second thing"
  ).replace("### Requirement: First thing", "###   Requirement: First thing");
  assert.deepEqual(countRequirements(looseSpacing), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("the requirements heading is matched case-insensitively", () => {
  // findSection compares titles case-insensitively and extractRequirementsSection
  // carries the /i flag, so `## requirements` is the real section — treating it
  // as a different heading would report every requirement hidden.
  const lowercase = CLEAN_SPEC.replace("## Requirements", "## requirements");
  assert.deepEqual(countRequirements(lowercase), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("a bold lead-in line groups topics without hiding anything", () => {
  // The sanctioned alternative to a `##` heading, so it must stay clean.
  const grouped = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    "**Grouping.**\n\n### Requirement: Second thing"
  );
  assert.deepEqual(countRequirements(grouped), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("a fenced '### Requirement:' example is not counted at all", () => {
  // It is documentation about the format, not a requirement the parser was
  // ever meant to see — counting it would report a hidden requirement that
  // does not exist.
  const withExample = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    [
      "### Requirement: Second thing",
      "",
      "```markdown",
      "### Requirement: An illustrative example",
      "```",
      "",
    ].join("\n")
  );
  assert.deepEqual(countRequirements(withExample), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("a fenced '## ' line does not close the requirements section", () => {
  const withHeadingExample = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    [
      "```markdown",
      "## Some Other Section",
      "```",
      "",
      "### Requirement: Second thing",
    ].join("\n")
  );
  assert.deepEqual(countRequirements(withHeadingExample), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

test("a lost opening fence is caught by the unclosed-fence rule", () => {
  // This is the cli-help defect: the opener is lost, so the template's `##`
  // becomes a real heading AND the surviving closer opens a region running to
  // end of file. The dangling fence hides the requirement below it from the
  // hidden-count too, which is exactly why an unclosed fence fails on its own.
  const lostOpener = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    ["## Goal", "```", "", "### Requirement: Second thing"].join("\n")
  );
  const result = countRequirements(lostOpener);
  assert.equal(result.unclosedFence, true);
  assert.equal(result.hidden, 0, "the dangling fence swallows the evidence");
});

test("main fails and explains an unclosed fence", () => {
  const lostOpener = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    ["## Goal", "```", "", "### Requirement: Second thing"].join("\n")
  );
  const directory = specTree({ gamma: lostOpener });
  try {
    const { ok, errors } = run(directory);
    assert.equal(ok, false);
    assert.match(
      errors.join("\n"),
      /gamma[/\\]spec\.md: a code fence is still open/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a tilde fence is honoured, and a longer fence contains a shorter one", () => {
  const nested = CLEAN_SPEC.replace(
    "### Requirement: Second thing",
    [
      "~~~markdown",
      "## Not A Heading",
      "~~~",
      "",
      "````",
      "```",
      "## Also Not",
      "````",
      "",
      "### Requirement: Second thing",
    ].join("\n")
  );
  assert.deepEqual(countRequirements(nested), {
    total: 2,
    visible: 2,
    hidden: 0,
    unclosedFence: false,
  });
});

/**
 * Drive main() over a directory, collecting what it would have printed.
 * The injected logger keeps these assertions off the global console, so no test
 * here depends on running sequentially with the others.
 */
function run(directory) {
  const logs = [];
  const errors = [];
  const { ok, results } = main({
    argv: [directory],
    log: (message) => logs.push(String(message)),
    error: (message) => errors.push(String(message)),
  });
  return { ok, results, logs, errors };
}

/** Build a temp `specs/<name>/spec.md` tree and return its directory. */
function specTree(specsByName) {
  const directory = mkdtempSync(join(tmpdir(), "openspec-visibility-"));
  for (const [name, source] of Object.entries(specsByName)) {
    mkdirSync(join(directory, name), { recursive: true });
    writeFileSync(join(directory, name, "spec.md"), source);
  }
  return directory;
}

test("checkSpecs reports one row per spec directory", () => {
  const directory = specTree({ alpha: CLEAN_SPEC, beta: TRUNCATED_SPEC });
  try {
    const results = checkSpecs(directory);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((result) => result.hidden),
      [0, 1]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("main fails and names the offending spec and count", () => {
  const directory = specTree({ alpha: CLEAN_SPEC, beta: TRUNCATED_SPEC });
  try {
    const { ok, errors } = run(directory);
    assert.equal(ok, false);
    const reported = errors.join("\n");
    assert.match(reported, /beta[/\\]spec\.md/);
    assert.match(reported, /1 requirement\(s\) hidden/);
    assert.doesNotMatch(reported, /alpha/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("main passes when every spec is clean", () => {
  const directory = specTree({ alpha: CLEAN_SPEC, beta: CLEAN_SPEC });
  try {
    assert.equal(run(directory).ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
