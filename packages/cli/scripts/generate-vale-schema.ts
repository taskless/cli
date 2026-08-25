/**
 * Derive the Vale rule vocabulary from the vendored binary.
 *
 * Vale publishes no JSON Schema, so `fetch-ast-grep-schema.ts` has nothing to
 * fetch here. What it does have is a binary that answers questions, and this
 * script asks them: every value in `src/generated/vale-vocabulary.ts` is the
 * recorded answer of the pinned Vale to a rule this script wrote and ran.
 *
 * ## The method rule
 *
 * **Every verdict comes from the process exit status and the structured JSON
 * Vale emits, never from grepping output for an error phrase.** That is not
 * style advice. A probe that greps stdout for `has invalid keys` reads a Go
 * panic — which contains no such string — as a clean run, and that is exactly
 * how a tokenless `sequence` rule once came to look like a check that
 * validates nothing. Run with `--output=JSON`; on a config error Vale writes
 * `{Line, Path, Text, Code, Span}` to **stderr**. Key on `Code`, parse `Text`
 * structurally, and treat every outcome that does not match a known shape as
 * fatal rather than folding it into "fine".
 *
 * ## What is derived and what is seeded
 *
 * Three of the four vocabularies are self-enumerating — the binary names its
 * own accepted set in the error it raises — and one is not:
 *
 * | Vocabulary       | Oracle                                                | Discovers? |
 * | ---------------- | ----------------------------------------------------- | ---------- |
 * | Check types      | `'extends' key must be one of [...]`                  | yes        |
 * | Levels           | `'level' must be one of [...]`                        | yes        |
 * | Per-check fields | `has invalid keys: '<name>'` — names the *bad* key    | no         |
 * | Scope operands   | none: an unknown scope is silent                      | no         |
 *
 * The bottom two rows are the honest limit of this script. `E201` names the key
 * you got wrong and never the ones you could have used, so a field table can
 * only be built by proposing a candidate and asking. **That verifies; it cannot
 * discover.** A real field nobody proposes is omitted from the artifact, and
 * the schema then rejects a rule Vale accepts — the too-strict direction, which
 * the design calls the worse failure. {@link FIELD_CANDIDATES} is therefore
 * seeded generously and carries its provenance.
 *
 * `scope` is worse still, because it has no oracle at all: an invalid scope is
 * silent, and so is a valid scope whose construct is missing from the fixture.
 * The verdict is three-valued, and only a hand-written fixture separates the
 * last two. See {@link SCOPE_CANDIDATES}.
 *
 * ## Failing loudly
 *
 * If the enumeration line stops matching its pattern, this script errors rather
 * than emitting a short enum. A truncated enum is *stricter* than the binary,
 * which is the failure direction that blocks working rules — so a parse that no
 * longer matches must never be allowed to look like a small vocabulary.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ValeConfigError } from "../src/rules/vale/map.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(scriptDirectory, "..");
const OUTPUT_PATH = resolve(
  PACKAGE_ROOT,
  "src",
  "generated",
  "vale-vocabulary.ts"
);
const REPORT_PATH = resolve(
  PACKAGE_ROOT,
  "src",
  "generated",
  "vale-vocabulary-report.md"
);

// --- Locating the binary -----------------------------------------------------

/**
 * The vendored binary, resolved the same way the CLI resolves it at runtime.
 *
 * `findValeBinary` lives in `src/`, which this script can import directly: it
 * runs under `tsx`, not under the bundle. Using the shipped resolver rather
 * than a second copy of the platform-package naming means a packaging change
 * cannot leave the generator probing a different Vale than the one `verify`
 * will hand rules to.
 */
const { findValeBinary } = await import("../src/rules/vale/binary.js");
const { VALE_VERSION } = await import("../src/rules/capabilities.js");
const { asValeConfigError } = await import("../src/rules/vale/map.js");

const resolution = findValeBinary();
if (resolution.path === undefined) {
  throw new Error(
    "no vendored Vale binary on this host, so there is nothing to derive from. " +
      "Run `pnpm install` in packages/cli and retry."
  );
}
const VALE = resolution.path;

{
  const probe = spawnSync(VALE, ["--version"], { encoding: "utf8" });
  const reported = /vale version (\d+\.\d+\.\d+)/.exec(probe.stdout ?? "")?.[1];
  if (reported !== VALE_VERSION) {
    throw new Error(
      `the vendored binary reports ${reported ?? "an unreadable version"} but ` +
        `VALE_VERSION is pinned to ${VALE_VERSION}. Derivation against a ` +
        `different binary than the one the schema claims to describe is the ` +
        `drift this artifact exists to prevent.`
    );
  }
}

// --- The probe ---------------------------------------------------------------

/**
 * What one run of the binary did, as a closed set of outcomes.
 *
 * There is deliberately no "other" member that a caller can shrug at. Every
 * shape this script does not recognize becomes {@link Unrecognized}, and every
 * consumer of a verdict must decide what to do about it — which in practice
 * means throwing.
 */
type ProbeOutcome =
  | { kind: "clean"; findings: number }
  | { kind: "diagnostic"; diagnostic: ValeConfigError }
  | { kind: "panic"; trace: string }
  | {
      kind: "unrecognized";
      status: number | null;
      stdout: string;
      stderr: string;
    };

/**
 * Run one rule over one document in a config isolated from everything else.
 *
 * `BasedOnStyles =` is load-bearing. Without it Vale loads its bundled styles
 * and a control document can trip one of those, which a finding count cannot
 * tell apart from the rule under test firing.
 *
 * `--no-exit` suppresses the non-zero status Vale returns merely for *finding*
 * something, so a non-zero status here means the config itself failed.
 *
 * **This config is the sibling of `buildIsolatingConfig` in
 * `src/rules/vale/verify.ts`, and the two are kept deliberately separate.**
 * They agree on three details: `MinAlertLevel = suggestion`, an empty
 * `BasedOnStyles =`, and exactly one assignment of the enabled key in exactly
 * one matcher, the last two of which that docstring explains are load-bearing.
 * They differ on the fourth, which is why this is not a call to that function:
 * `buildIsolatingConfig` needs an absolute `StylesPath` because it writes its
 * config to a temp directory while the styles stay in the user's
 * `.taskless/rules/vale/<id>` tree, whereas this
 * probe owns the whole temp directory and points at a `styles/probe/probe.yml`
 * beside the config. Reuse would mean staging a fake `.taskless` layout in tmp
 * just to satisfy a path convention no probe has. If a future requirement is
 * discovered against either recipe (another key Vale needs to isolate a rule),
 * apply it to both.
 */
function probe(
  rule: string,
  document: string,
  extension: string
): ProbeOutcome {
  const cwd = mkdtempSync(join(tmpdir(), "vale-derive-"));
  try {
    mkdirSync(join(cwd, "styles", "probe"), { recursive: true });
    writeFileSync(join(cwd, "styles", "probe", "probe.yml"), rule);
    writeFileSync(
      join(cwd, ".vale.ini"),
      "StylesPath = styles\nMinAlertLevel = suggestion\n\n[*]\nBasedOnStyles =\nprobe.probe = YES\n"
    );
    writeFileSync(join(cwd, `doc.${extension}`), document);

    const result = spawnSync(
      VALE,
      [
        "--config",
        ".vale.ini",
        "--output=JSON",
        "--no-exit",
        "--",
        `doc.${extension}`,
      ],
      { cwd, encoding: "utf8" }
    );

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    if (stderr.includes("panic:")) return { kind: "panic", trace: stderr };

    if (result.status === 0) {
      const payload: unknown = JSON.parse(stdout || "{}");
      if (
        Array.isArray(payload) ||
        typeof payload !== "object" ||
        payload === null
      ) {
        return { kind: "unrecognized", status: result.status, stdout, stderr };
      }
      const findings = Object.values(
        payload as Record<string, unknown[]>
      ).flat();
      return { kind: "clean", findings: findings.length };
    }

    const diagnostic = readDiagnostic(stderr);
    if (diagnostic !== undefined) return { kind: "diagnostic", diagnostic };

    return { kind: "unrecognized", status: result.status, stdout, stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Read Vale's diagnostic object off stderr.
 *
 * Vale writes one JSON object per config error, pretty-printed and possibly
 * several in a row. `JSON.parse` handles the single-object case; anything else
 * returns `undefined` and becomes {@link ProbeOutcome} `unrecognized`, which
 * every caller treats as fatal. That is the point: an unreadable diagnostic
 * must never be mistaken for a clean run.
 *
 * The shape check itself is {@link asValeConfigError}, the one the CLI already
 * runs over the same payload at runtime. Deriving against a second local copy
 * of `{Code, Text, ...}` would mean a future change to Vale's diagnostic
 * envelope has to be found twice, and nothing would report the half that was
 * missed.
 */
function readDiagnostic(stderr: string): ValeConfigError | undefined {
  const trimmed = stderr.trim();
  if (trimmed === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  return asValeConfigError(Array.isArray(parsed) ? parsed[0] : parsed);
}

/**
 * Read a value the generator itself produced, refusing `undefined`.
 *
 * `noUncheckedIndexedAccess` is right to insist on this rather than being
 * silenced with a `!`. A missing entry means a check type was lost between two
 * stages of the derivation, and the alternative to throwing is emitting a
 * vocabulary with a silently empty field table — which is the too-strict
 * failure, dressed up as a successful run.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(
      `internal: ${what} is missing, so the derivation is incomplete and the ` +
        `artifact would be emitted short. This is a bug in the generator.`
    );
  }
  return value;
}

/** A probe outcome this script has no handling for is never survivable. */
function fatal(context: string, outcome: ProbeOutcome): never {
  const detail =
    outcome.kind === "panic"
      ? `the binary panicked:\n${outcome.trace.split("\n").slice(0, 3).join("\n")}`
      : outcome.kind === "unrecognized"
        ? `unrecognized outcome (status ${String(outcome.status)}):\n` +
          `stdout: ${outcome.stdout.slice(0, 400)}\nstderr: ${outcome.stderr.slice(0, 400)}`
        : outcome.kind === "diagnostic"
          ? `unexpected ${outcome.diagnostic.Code}: ${outcome.diagnostic.Text}`
          : `unexpected clean run (${String(outcome.findings)} findings)`;
  throw new Error(`${context}: ${detail}`);
}

// --- Stage 1: the self-enumerating vocabularies ------------------------------

/**
 * Ask the binary to name its own accepted set.
 *
 * Both `extends` and `level` reject an unknown value by enumerating the legal
 * ones, so the probe supplies a sentinel and reads the list back out of the
 * diagnostic's `Text`. Nothing here is proposed and then confirmed: the set
 * arrives whole, which is why a Vale release that adds a check type is picked
 * up rather than merely failing a test.
 *
 * The pattern is anchored on the whole line, and a miss throws. **A truncated
 * enum is stricter than the binary**, so "the message changed shape" must never
 * degrade into "the vocabulary got smaller".
 */
function enumerateFromBinary(
  key: "extends" | "level",
  rule: string,
  { sorted }: { sorted: boolean }
): string[] {
  const outcome = probe(rule, "bogus simply here.\n", "md");
  if (outcome.kind !== "diagnostic") {
    fatal(
      `enumerating '${key}': the binary did not reject the sentinel`,
      outcome
    );
  }
  const { Code, Text } = outcome.diagnostic;
  if (Code !== "E201") {
    throw new Error(
      `enumerating '${key}': expected diagnostic code E201, got ${Code} ` +
        `("${Text}"). The generator refuses to guess at a vocabulary from an ` +
        `error shape it does not know.`
    );
  }
  const match = new RegExp(String.raw`^'${key}'[^[\]]*\[([^\]]+)\]\.?$`).exec(
    Text
  );
  if (match === null) {
    throw new Error(
      `enumerating '${key}': Vale ${VALE_VERSION} answered "${Text}", which no ` +
        `longer matches the enumeration shape this generator reads. Refusing ` +
        `to emit a vocabulary: a short enum is STRICTER than the binary, so a ` +
        `silent partial parse would start rejecting rules Vale accepts. Fix ` +
        `the pattern against the new message.`
    );
  }
  const raw = must(match[1], `the '${key}' enumeration group`)
    .trim()
    .split(/\s+/);
  if (raw.length === 0) {
    throw new Error(`enumerating '${key}': the enumeration parsed as empty.`);
  }
  return sorted ? raw.toSorted() : raw;
}

/**
 * Check types are sorted; levels are left in the order the binary gave them.
 *
 * The difference is that one order carries meaning and the other does not. The
 * check types come out of the binary unordered, so sorting makes the list
 * `verify` prints to an author predictable. The levels come out in *severity*
 * order — suggestion, warning, error — and alphabetising them would throw that
 * away for nothing.
 */
const CHECK_TYPES = enumerateFromBinary(
  "extends",
  'extends: __taskless_probe__\nmessage: "x"\nlevel: error\ntokens: [bogus]\n',
  { sorted: true }
);
const LEVELS = enumerateFromBinary(
  "level",
  'extends: existence\nmessage: "x"\nlevel: __taskless_probe__\ntokens: [bogus]\n',
  { sorted: false }
);

console.log(
  `Vale ${VALE_VERSION}: ${String(CHECK_TYPES.length)} check types, ${String(LEVELS.length)} levels`
);

// --- Stage 2: the per-check field tables -------------------------------------

/**
 * A minimal rule per check type that the binary runs without complaint.
 *
 * **Hand-seeded, and it has to be.** A field probe adds one candidate key to a
 * rule and asks whether the key was rejected — which is only meaningful if
 * everything *else* in the rule was already fine. Several checks are not valid
 * empty: a `sequence` with no `tokens` panics rather than reporting, and a
 * `metric` with a `formula` and no `condition` does the same. So each base is a
 * working rule of its check, and stage 2 asserts that before probing anything.
 *
 * Provenance: each is the minimal form of the corresponding row in
 * `test/vale-corpus.ts`, which measured it accepted against this binary.
 */
const CHECK_BASES: Record<string, Record<string, unknown>> = {
  existence: { tokens: ["bogus"] },
  substitution: { swap: { utilize: "use" } },
  capitalization: { match: "$title", style: "AP" },
  occurrence: { token: "very", max: 1 },
  repetition: { tokens: [String.raw`[^\s]+`] },
  conditional: {
    first: String.raw`\b([A-Z]{3,5})\b`,
    second: String.raw`(?:\b[A-Z][a-z]+ )+\(([A-Z]{3,5})\)`,
  },
  metric: { formula: "(characters / words)", condition: "> 1" },
  readability: { metrics: ["Gunning Fog"], grade: 1 },
  sequence: { tokens: [{ pattern: "a" }] },
  script: { script: "matches := []\n" },
  consistency: { either: { advisor: "adviser" } },
  spelling: {},
};

/**
 * The candidate universe, and why each name is in it.
 *
 * **This list is the generator's one irreducible act of authorship.** `E201`
 * names the key you got wrong, never the ones you could have used, so a field
 * table can only be verified, never discovered. A real field absent from here
 * is absent from the artifact, and the schema then rejects a rule the binary
 * runs — the "too strict" failure the design ranks as the worse one.
 *
 * Seeded generously and from four independent sources, so that a name missing
 * from one is likely present in another:
 *
 * 1. **Vale's published key documentation** (`vale.sh/docs/keys`), including
 *    names the binary turns out to reject — `prefixes`, `suffixes` and
 *    `ignorecase` on `capitalization` are documented and measured rejected, and
 *    keeping them here is what makes that a recorded finding rather than an
 *    omission.
 * 2. **The hand transcription this artifact replaces**, so the generator is
 *    strictly a superset of what a human already established.
 * 3. **Vale's shared/common keys** — `link`, `limit`, `action`, `scope`,
 *    `description`, `name`, `comment`, `vocab`.
 * 4. **Neighbouring checks' fields**, deliberately cross-probed: every field of
 *    every check is offered to every other check, which is what turns the
 *    per-check tables into a measured partition rather than twelve unrelated
 *    lists.
 */
const FIELD_CANDIDATES: readonly string[] = [
  // Header and shared keys (source 3).
  "extends",
  "message",
  "level",
  "scope",
  "link",
  "limit",
  "action",
  "description",
  "name",
  "comment",
  "vocab",
  // Documented per-check keys (sources 1, 2 and 4 — cross-probed).
  "tokens",
  "token",
  "raw",
  "ignorecase",
  "nonword",
  "exceptions",
  "append",
  "swap",
  "capitalize",
  "pos",
  "match",
  "style",
  "threshold",
  "indicators",
  "prefix",
  "prefixes",
  "suffixes",
  "max",
  "min",
  "alpha",
  "first",
  "second",
  "formula",
  "condition",
  "metrics",
  "grade",
  "script",
  "either",
  "filter",
  "filters",
  "ignore",
  "dicpath",
  "dictionaries",
  "custom",
  "aff",
  "dic",
  "negate",
  "ordered",
  "chars",
  "pattern",
  "tag",
].toSorted();

/**
 * A key no check has, used to ask whether a check validates its keys at all.
 *
 * Two of the twelve do not: `consistency` and `spelling` accept any key and
 * ignore it. That is measured rather than assumed, because the schema's answer
 * differs in the direction that matters — a strict object over a permissive
 * check rejects rules the binary runs.
 */
const SENTINEL_FIELD = "taskless_generator_sentinel";

/** How the binary answered "is this a key of this check?". */
type Membership = "member" | "not-a-member";

/**
 * Parse the invalid-key list out of a diagnostic, structurally.
 *
 * `has invalid keys: 'a', 'b'` is the only membership oracle Vale offers, and
 * it is read as a *list of names* rather than matched as a phrase. A diagnostic
 * that names a key we did not probe means the base rule is contaminated, which
 * is fatal — the alternative is recording a verdict about the wrong key.
 */
function invalidKeys(text: string): string[] | undefined {
  const match = /^has invalid keys: (.+)$/.exec(text);
  if (match === null) return undefined;
  return [...must(match[1], "the invalid-key list").matchAll(/'([^']+)'/g)].map(
    (found) => must(found[1], "an invalid key name").toLowerCase()
  );
}

function toYaml(rule: Record<string, unknown>): string {
  return (
    Object.entries(rule)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n") + "\n"
  );
}

/**
 * The keys Vale reads before it decodes a check at all.
 *
 * They are members of every check by construction — each base rule above
 * carries all three and was verified running clean — so they are never probed.
 * Probing them would also be actively unsound: the probe value is arbitrary,
 * and `extends: true` reaches a bare `interface{}` to `string` conversion that
 * panics the process rather than reporting anything.
 */
const HEADER_FIELDS = ["extends", "message", "level"];

/**
 * Ask one question: does `check` accept `field` as a key?
 *
 * The verdict is a read of a closed outcome set, never a grep. The probe sets
 * the field to an arbitrary value (`true`), so every outcome has to be
 * interpreted as evidence about the *key* rather than about the value:
 *
 * - a clean run means the key was decoded, so it is a member;
 * - `has invalid keys` naming this field means it is not — this is the only
 *   negative oracle Vale offers, and it is parsed as a list of names;
 * - **any other diagnostic means member.** Vale recognized the key and objected
 *   to its value or type instead, which is membership evidence;
 * - **a panic means member, for the same reason.** A key Vale does not know is
 *   collected and reported as unused; it is never dereferenced. Reaching a
 *   type conversion at all proves the key was routed somewhere.
 *
 * The last two are inferences rather than direct readings, so both are recorded
 * and printed with the artifact. An inference nobody can audit is a grep with
 * better manners.
 *
 * An invalid-key list naming a key we did not probe, or a diagnostic this
 * script cannot parse, stays fatal: both mean the verdict would be about
 * something other than the question asked.
 */
const typeObjections: string[] = [];
const panicObjections: string[] = [];

function probeField(
  check: string,
  field: string,
  { panicIsEvidence }: { panicIsEvidence: boolean }
): Membership {
  const rule: Record<string, unknown> = {
    extends: check,
    message: "x %s",
    level: "error",
    ...CHECK_BASES[check],
    [field]: true,
  };
  const outcome = probe(toYaml(rule), "bogus simply here.\n", "md");

  if (outcome.kind === "clean") return "member";
  if (outcome.kind === "panic" && panicIsEvidence) {
    panicObjections.push(
      `${check}.${field}: ${(outcome.trace.split("\n")[0] ?? "").trim()}`
    );
    return "member";
  }
  if (outcome.kind !== "diagnostic") {
    fatal(`probing '${field}' on the ${check} check`, outcome);
  }

  const { Code, Text } = outcome.diagnostic;
  if (Code !== "E201") {
    throw new Error(
      `probing '${field}' on the ${check} check: diagnostic code ${Code} is ` +
        `not one this generator knows how to read ("${Text}").`
    );
  }

  const named = invalidKeys(Text);
  if (named === undefined) {
    typeObjections.push(`${check}.${field}: ${Text}`);
    return "member";
  }
  if (named.includes(field.toLowerCase())) return "not-a-member";

  throw new Error(
    `probing '${field}' on the ${check} check: Vale rejected ${named
      .map((key) => `'${key}'`)
      .join(", ")}, which is not the key under test. The base rule for ` +
      `${check} is contaminated, so no verdict here is trustworthy.`
  );
}

/** Verify the base rule before trusting a single verdict taken against it. */
for (const check of CHECK_TYPES) {
  const base = CHECK_BASES[check];
  if (base === undefined) {
    throw new Error(
      `Vale ${VALE_VERSION} has a '${check}' check with no base rule in ` +
        `CHECK_BASES. A field table cannot be probed without a working rule ` +
        `of that check to probe against — add one and re-run.`
    );
  }
  const outcome = probe(
    toYaml({ extends: check, message: "x %s", level: "error", ...base }),
    "bogus simply here.\n",
    "md"
  );
  if (outcome.kind !== "clean") {
    fatal(`the base rule for the ${check} check is not valid`, outcome);
  }
}

const permissiveChecks: string[] = [];
const acceptedFields: Record<string, string[]> = {};

for (const check of CHECK_TYPES) {
  // The sentinel is the one probe where a panic is *not* read as evidence. It
  // decides whether the check validates keys at all, and a permissive verdict
  // taken from a crash would make the schema loose for a check that is strict.
  if (
    probeField(check, SENTINEL_FIELD, { panicIsEvidence: false }) === "member"
  ) {
    permissiveChecks.push(check);
    continue;
  }
  const accepted = new Set([
    ...HEADER_FIELDS,
    ...Object.keys(must(CHECK_BASES[check], `the base rule for ${check}`)),
  ]);
  for (const field of FIELD_CANDIDATES) {
    if (accepted.has(field)) continue;
    if (probeField(check, field, { panicIsEvidence: true }) === "member") {
      accepted.add(field);
    }
  }
  acceptedFields[check] = [...accepted].toSorted();
  console.log(`  ${check}: ${String(accepted.size)} fields`);
}

/**
 * The fields every strict check takes, derived rather than declared.
 *
 * This is the intersection of the twelve measured tables, which is a stronger
 * statement than a hand-written "common" list: `vocab` is *not* here, because
 * five checks reject it, and nothing had to remember that. The permissive
 * checks are excluded from the intersection — they accept everything, so they
 * constrain nothing.
 */
const strictChecks = CHECK_TYPES.filter(
  (check) => !permissiveChecks.includes(check)
);
const tableFor = (check: string): string[] =>
  must(acceptedFields[check], `the measured field table for ${check}`);

const commonFields = FIELD_CANDIDATES.filter((field) =>
  strictChecks.every((check) => tableFor(check).includes(field))
);

const checkFields: Record<string, string[]> = {};
for (const check of strictChecks) {
  checkFields[check] = tableFor(check).filter(
    (field) => !commonFields.includes(field)
  );
}

// --- Stage 3: the scope operands ---------------------------------------------

/**
 * A scope candidate, its fixture, and where the name came from.
 *
 * **`scope` has no oracle.** Vale does not reject an unknown scope: the rule
 * loads, runs, and matches nothing, which from outside is indistinguishable
 * from a valid scope whose construct is absent from the document. So the
 * verdict is three-valued —
 *
 * | Verdict         | What happened                                       |
 * | --------------- | --------------------------------------------------- |
 * | `fires`         | the rule flagged the fixture: the operand is real    |
 * | `silent`        | the fixture was linted and the rule found nothing    |
 * | `unreachable`   | the fixture was never linted at all                  |
 *
 * — and only a hand-written fixture separates the middle from the last. Every
 * fixture contains the word `bogus`, and a reach probe (`scope: raw`) must fire
 * on it; if it does not, the fixture is broken and the run is fatal, because
 * "did not fire" would then say nothing about the operand.
 *
 * `documented` records whether Vale's own documentation names the operand. It
 * is not evidence — the binary is — but the disagreements are the report this
 * script emits, and a disagreement can only be stated if both sides are here.
 *
 * `ext` matters more than it looks: the file extension decides which parser
 * Vale routes the document to, and `comment.*` only exists in a source tier.
 */
interface ScopeCandidate {
  operand: string;
  fixture: string;
  ext: string;
  documented: boolean;
  /** For a family whose tail is author-supplied, the prefix to record. */
  prefix?: string;
  /** Why this candidate is worth probing, when that is not obvious. */
  note?: string;
}

const MARKDOWN_HEADING = (level: number): string =>
  `${"#".repeat(level)} Level ${String(level)} bogus heading\n`;

const PROSE = "Just bogus do it.\n";
const FRONTMATTER = "---\ntitle: bogus meta\n---\n\nBody text here.\n";
const JS_COMMENTS = "// bogus line\n/*\n bogus block\n*/\nconst x = 1;\n";
const TS_COMMENTS =
  "// bogus line\n/*\n bogus block\n*/\nconst x: number = 1;\n";
const TABLE = "| Head |\n| --- |\n| bogus |\n";

const SCOPE_CANDIDATES: readonly ScopeCandidate[] = [
  { operand: "text", fixture: PROSE, ext: "md", documented: true },
  {
    operand: "code",
    fixture: "Run `bogus now` here.\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "raw",
    fixture: "Prose bogus.\n\n```\nbogus fenced\n```\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "heading",
    fixture: "# Do bogus things\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h1",
    fixture: MARKDOWN_HEADING(1),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h2",
    fixture: MARKDOWN_HEADING(2),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h3",
    fixture: MARKDOWN_HEADING(3),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h4",
    fixture: MARKDOWN_HEADING(4),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h5",
    fixture: MARKDOWN_HEADING(5),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h6",
    fixture: MARKDOWN_HEADING(6),
    ext: "md",
    documented: true,
  },
  {
    operand: "heading.h7",
    fixture: MARKDOWN_HEADING(1),
    ext: "md",
    documented: false,
    note: "the negative control for the heading family: HTML stops at h6.",
  },
  {
    operand: "paragraph",
    fixture: "A bogus paragraph here.\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "sentence",
    fixture: "A bogus sentence here.\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "list",
    fixture: "- bogus one\n- two\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "blockquote",
    fixture: "> A bogus quote.\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "link",
    fixture: "See [bogus link](https://example.com).\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "alt",
    fixture: "![bogus alt text](x.png)\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "summary",
    fixture:
      "<details><summary>bogus summary</summary>\n\nbody\n\n</details>\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "strong",
    fixture: "This is **bogus bold** text.\n",
    ext: "md",
    documented: true,
  },
  {
    operand: "emphasis",
    fixture: "This is *bogus italic* text.\n",
    ext: "md",
    documented: true,
  },
  { operand: "table", fixture: TABLE, ext: "md", documented: true },
  {
    operand: "table.header",
    fixture: "| bogus |\n| --- |\n| body |\n",
    ext: "md",
    documented: true,
  },
  { operand: "table.cell", fixture: TABLE, ext: "md", documented: true },
  {
    operand: "table.caption",
    fixture:
      "<table><caption>bogus caption</caption><tr><td>body</td></tr></table>\n",
    ext: "html",
    documented: true,
  },
  {
    operand: "table.row",
    fixture: TABLE,
    ext: "md",
    documented: false,
    note: "the negative control for the table family.",
  },
  {
    operand: "figure.caption",
    fixture: "<figcaption>bogus caption</figcaption>\n",
    ext: "html",
    documented: true,
    note:
      "bare, NOT nested in <figure>. Vale drops everything inside a <figure> " +
      "element, so the nested form is unreachable — see the divergence report.",
  },
  {
    operand: "meta",
    fixture: FRONTMATTER,
    ext: "md",
    documented: true,
    note: "documented by Vale; measured never firing. See the divergence report.",
  },
  {
    operand: "meta.class.title",
    fixture: FRONTMATTER,
    ext: "md",
    documented: true,
    prefix: "meta.class.",
    note: "documented by Vale; measured never firing. See the divergence report.",
  },
  {
    operand: "frontmatter",
    fixture: FRONTMATTER,
    ext: "md",
    documented: false,
    note: "documented nowhere and measured working — the standing proof that this generator verifies rather than discovers.",
  },
  {
    operand: "frontmatter.title",
    fixture: FRONTMATTER,
    ext: "md",
    documented: false,
    prefix: "frontmatter.",
  },
  {
    operand: "text.class.foo",
    fixture: '<html><body><p class="foo">bogus here</p></body></html>\n',
    ext: "html",
    documented: true,
    prefix: "text.class.",
  },
  { operand: "comment", fixture: JS_COMMENTS, ext: "js", documented: true },
  {
    operand: "comment.line",
    fixture: "// bogus line\nconst x = 1;\n",
    ext: "js",
    documented: true,
  },
  {
    operand: "comment.block",
    fixture: "/*\n bogus block\n*/\nconst x = 1;\n",
    ext: "js",
    documented: true,
  },
  {
    operand: "comment.line",
    fixture: TS_COMMENTS,
    ext: "ts",
    documented: true,
    note: "the same operand in the TypeScript tier, which routes through a different parser.",
  },
  {
    operand: "comment.block",
    fixture: TS_COMMENTS,
    ext: "ts",
    documented: true,
    note: "the same operand in the TypeScript tier.",
  },
  {
    operand: "fenced",
    fixture: "Prose bogus.\n\n```\nbogus fenced\n```\n",
    ext: "md",
    documented: false,
    note: "the negative control an author is most likely to reach for.",
  },
  {
    operand: "banana",
    fixture: PROSE,
    ext: "md",
    documented: false,
    note: "the negative control that cannot possibly be a scope.",
  },
];

type ScopeVerdict = "fires" | "silent" | "unreachable";

/** The reach probe: proves a fixture was linted at all, independent of scope. */
const REACH_RULE =
  'extends: existence\nmessage: "x %s"\nlevel: error\nscope: raw\nnonword: true\ntokens:\n  - bogus\n';

interface ScopeMeasurement {
  candidate: ScopeCandidate;
  verdict: ScopeVerdict;
}

const scopeMeasurements: ScopeMeasurement[] = [];

for (const candidate of SCOPE_CANDIDATES) {
  const rule =
    'extends: existence\nmessage: "x %s"\nlevel: error\n' +
    `scope: ${JSON.stringify(candidate.operand)}\ntokens:\n  - bogus\n`;

  const reach = probe(REACH_RULE, candidate.fixture, candidate.ext);
  if (reach.kind !== "clean") {
    fatal(`the reach probe on the ${candidate.operand} fixture`, reach);
  }
  if (reach.findings === 0) {
    throw new Error(
      `scope '${candidate.operand}': the reach probe did not fire on its ` +
        `.${candidate.ext} fixture, so the fixture was never linted — wrong ` +
        `extension, unparseable format, or an unmatched glob. Any verdict ` +
        `taken here would say nothing about the operand.`
    );
  }

  const outcome = probe(rule, candidate.fixture, candidate.ext);
  if (outcome.kind !== "clean") {
    fatal(`probing scope '${candidate.operand}'`, outcome);
  }
  const verdict: ScopeVerdict = outcome.findings > 0 ? "fires" : "silent";
  scopeMeasurements.push({ candidate, verdict });
  console.log(`  scope ${candidate.operand} (.${candidate.ext}): ${verdict}`);
}

/**
 * The operands the schema will honor: the ones measured firing, nothing else.
 *
 * An operand that never fired for any fixture is not in the artifact, whatever
 * the documentation says about it. That is the whole asymmetry `scope` is
 * subject to — a scope Vale does not have costs an author a rule that is inert
 * forever, with no error anywhere.
 */
const firing = scopeMeasurements.filter(({ verdict }) => verdict === "fires");
const scopeOperands = [
  ...new Set(
    firing
      .filter(({ candidate }) => candidate.prefix === undefined)
      .map(({ candidate }) => candidate.operand)
  ),
].toSorted();
const scopePrefixes = [
  ...new Set(
    firing
      .filter(({ candidate }) => candidate.prefix !== undefined)
      .map(({ candidate }) => candidate.prefix as string)
  ),
].toSorted();

// --- Stage 4: the divergence report ------------------------------------------

/**
 * Where the binary and the documentation disagree.
 *
 * These are the findings a generator must never drop silently. A documented
 * operand that never fires is a trap an author walks into with the docs open;
 * an undocumented one that works is the standing proof that a candidate list
 * verifies rather than discovers, and that something real could be missing from
 * it. Both go into a checked-in report, not into a console line nobody reads.
 */
interface Divergence {
  subject: string;
  finding: string;
  consequence: string;
}

const divergences: Divergence[] = [];

const byOperand = new Map<string, ScopeMeasurement[]>();
for (const measurement of scopeMeasurements) {
  const existing = byOperand.get(measurement.candidate.operand) ?? [];
  existing.push(measurement);
  byOperand.set(measurement.candidate.operand, existing);
}

for (const [operand, measurements] of byOperand) {
  const documented = measurements.some(({ candidate }) => candidate.documented);
  const fires = measurements.some(({ verdict }) => verdict === "fires");
  const negativeControl = measurements.every(({ candidate }) =>
    (candidate.note ?? "").includes("negative control")
  );

  if (documented && !fires) {
    divergences.push({
      subject: `scope: ${operand}`,
      finding:
        `Vale ${VALE_VERSION} documents this operand and it never fired, on ` +
        `any fixture probed (${measurements
          .map(({ candidate }) => `.${candidate.ext}`)
          .join(", ")}).`,
      consequence:
        "It is omitted from the vocabulary, so `verify` rejects it. A rule " +
        "written from the documentation would otherwise load, run, and match " +
        "nothing, with no error reported anywhere.",
    });
  }

  if (!documented && fires && !negativeControl) {
    divergences.push({
      subject: `scope: ${operand}`,
      finding: `This operand fired and Vale ${VALE_VERSION} documents it nowhere.`,
      consequence:
        "It is included in the vocabulary. It is also the standing " +
        "counterexample to trusting the candidate list: a real operand nobody " +
        "proposes is simply absent, and the schema then rejects a rule the " +
        "binary honors.",
    });
  }

  // A partial firing — the same operand alive in one tier and dead in another —
  // is a divergence in its own right, and the one most likely to be read as a
  // broken fixture rather than as a property of the binary.
  const alive = measurements.filter(({ verdict }) => verdict === "fires");
  const dead = measurements.filter(({ verdict }) => verdict !== "fires");
  if (alive.length > 0 && dead.length > 0) {
    divergences.push({
      subject: `scope: ${operand}`,
      finding:
        `Fires in ${alive.map(({ candidate }) => `.${candidate.ext}`).join(", ")} ` +
        `and is silent in ${dead.map(({ candidate }) => `.${candidate.ext}`).join(", ")}, ` +
        `on fixtures the reach probe confirmed were linted in both cases.`,
      consequence:
        "The operand stays in the vocabulary — it is real — but it is not " +
        "portable across formats, and `verify` cannot tell an author which " +
        "tier they are in.",
    });
  }
}

for (const check of permissiveChecks) {
  divergences.push({
    subject: `extends: ${check}`,
    finding:
      `This check accepted '${SENTINEL_FIELD}', a key no check has. It does ` +
      "not validate its keys at all.",
    consequence:
      "The schema is permissive here. Being strict would reject rules the " +
      "binary runs, to catch a typo that costs nothing but a field quietly " +
      "ignored — the too-strict direction, which is the worse failure.",
  });
}

if (typeObjections.length > 0) {
  divergences.push({
    subject: "field probes: membership inferred from a type complaint",
    finding:
      `${String(typeObjections.length)} probes drew an E201 that was not an ` +
      `invalid-key list: ${typeObjections.join("; ")}.`,
    consequence:
      "Each is recorded as a member: Vale recognized the key and objected to " +
      "the probe's arbitrary value instead, which is membership evidence. " +
      "They are listed so the inference is auditable rather than assumed.",
  });
}

if (panicObjections.length > 0) {
  divergences.push({
    subject: "field probes: membership inferred from a crash",
    finding:
      `${String(panicObjections.length)} probes panicked the binary: ` +
      `${panicObjections.join("; ")}.`,
    consequence:
      "Each is recorded as a member. A key Vale does not know is collected " +
      "and reported as unused, never dereferenced — so reaching a type " +
      "conversion at all proves the key was routed somewhere. This is the " +
      "weakest inference the generator makes, which is why it is named here.",
  });
}

// --- Emit --------------------------------------------------------------------

function literalList(values: readonly string[]): string {
  return values.map((value) => `  ${JSON.stringify(value)},`).join("\n");
}

const artifact = `/**
 * The Vale rule vocabulary, derived from the vendored binary.
 *
 * GENERATED FILE — DO NOT EDIT. Run \`pnpm generate:vale-schema\` in
 * \`packages/cli\` to reproduce it. The generator is
 * \`scripts/generate-vale-schema.ts\`, and its header explains what each value
 * below was measured with and what it is worth.
 *
 * Derived against Vale ${VALE_VERSION}. Every value here is the recorded answer
 * of that binary to a rule the generator wrote and ran; nothing is transcribed
 * from documentation. Where the binary and the documentation disagree, the
 * disagreement is in \`vale-vocabulary-report.md\` rather than dropped.
 *
 * \`src/schemas/vale-rule.ts\` turns these into the zod schema \`verify\` runs.
 */

/** The binary this vocabulary was derived from. */
export const VALE_VOCABULARY_VERSION = ${JSON.stringify(VALE_VERSION)};

/**
 * Vale's check types, self-enumerated: an unknown \`extends\` makes the binary
 * name the whole set, so this is discovered rather than proposed.
 */
export const VALE_CHECK_TYPES = [
${literalList(CHECK_TYPES)}
] as const;

/**
 * Vale's severities, self-enumerated the same way, and left in the binary's
 * own order because that order is severity. The value is case-sensitive.
 */
export const VALE_LEVELS = [
${literalList(LEVELS)}
] as const;

/**
 * The checks that accept any key at all and ignore what they do not know.
 *
 * Measured by offering each check a sentinel key no check has.
 */
export const VALE_PERMISSIVE_CHECKS = [
${literalList(permissiveChecks.toSorted())}
] as const;

/**
 * The fields every strict check accepts, as the intersection of their measured
 * tables rather than as a declared list.
 *
 * Note what the intersection excludes: \`vocab\` is per-check, because several
 * checks reject it.
 */
export const VALE_COMMON_FIELDS = [
${literalList(commonFields)}
] as const;

/**
 * Each strict check's own fields — its measured table minus the common ones.
 *
 * Membership only: \`E201\` names the key you got wrong and never the ones you
 * could have used, so every name here was proposed by the generator's candidate
 * list and confirmed. A real field nobody proposed is absent.
 */
export const VALE_CHECK_FIELDS = {
${strictChecks
  .toSorted()
  .map(
    (check) =>
      `  ${check}: [\n${must(
        checkFields[check],
        `the emitted table for ${check}`
      )
        .map((field) => `    ${JSON.stringify(field)},`)
        .join("\n")}\n  ],`
  )
  .join("\n")}
} as const;

/**
 * The \`scope\` operands measured firing on a fixture carrying their construct.
 *
 * \`scope\` has no oracle — an unknown scope is silent, and so is a valid scope
 * with no construct to match — so an operand is here only if a rule using it
 * flagged a fixture that a reach probe independently confirmed was linted.
 */
export const VALE_SCOPE_OPERANDS = [
${literalList(scopeOperands)}
] as const;

/**
 * Scope families whose tail is author-supplied and cannot be enumerated.
 *
 * \`frontmatter.title\` names a key in the document's own front matter;
 * \`text.class.callout\` names an HTML class. Rejecting an unfamiliar tail would
 * be the too-strict failure against a value the binary honors.
 */
export const VALE_SCOPE_PREFIXES = [
${literalList(scopePrefixes)}
] as const;

/**
 * Where Vale ${VALE_VERSION} and its documentation disagree.
 *
 * Carried in the artifact rather than only in the report, so that a consumer
 * can render them and a reviewer cannot miss them in a diff.
 */
export const VALE_DIVERGENCES = [
${divergences
  .map(
    (divergence) =>
      `  {\n    subject: ${JSON.stringify(divergence.subject)},\n    finding:\n      ${JSON.stringify(divergence.finding)},\n    consequence:\n      ${JSON.stringify(divergence.consequence)},\n  },`
  )
  .join("\n")}
] as const;
`;

writeFileSync(OUTPUT_PATH, artifact, "utf8");

const report = `# Vale ${VALE_VERSION} vocabulary: divergence report

GENERATED FILE — DO NOT EDIT. Produced by \`pnpm generate:vale-schema\`
alongside \`vale-vocabulary.ts\`.

Every value in the vocabulary is the recorded answer of the vendored Vale
${VALE_VERSION} binary. This file is what the binary said that its own
documentation does not, in both directions. A generator that dropped these
would be quietly deciding which of the two to believe.

## What was derived, and what was seeded

| Vocabulary | Oracle | Discovers? |
| --- | --- | --- |
| Check types (${String(CHECK_TYPES.length)}) | \`'extends' key must be one of [...]\` | yes |
| Levels (${String(LEVELS.length)}) | \`'level' must be one of [...]\` | yes |
| Per-check fields | \`has invalid keys: '<name>'\` | **no — membership only** |
| Scope operands | none; an unknown scope is silent | **no — fixture probe** |

The bottom two rows are verified, not discovered. \`E201\` names the key you got
wrong and never the ones you could have used, and an unknown scope produces no
error at all. A real field or operand that the generator's candidate list does
not propose is simply absent from the vocabulary, and the schema then rejects a
rule the binary accepts — the too-strict direction, which the design ranks as
the worse failure.

## Divergences

${
  divergences.length === 0
    ? "None. The binary and the documentation agreed everywhere probed."
    : divergences
        .map(
          (divergence) =>
            `### \`${divergence.subject}\`\n\n${divergence.finding}\n\n**Consequence.** ${divergence.consequence}`
        )
        .join("\n\n")
}

## Every scope probed

| Operand | Fixture | Documented | Verdict |
| --- | --- | --- | --- |
${scopeMeasurements
  .map(
    ({ candidate, verdict }) =>
      `| \`${candidate.operand}\` | \`.${candidate.ext}\` | ${candidate.documented ? "yes" : "no"} | ${verdict} |`
  )
  .join("\n")}
`;

writeFileSync(REPORT_PATH, report, "utf8");

// Formatting is delegated to the repository's own prettier rather than hand
// matched here, so the artifact survives `lint-staged` untouched and a
// re-generation is a no-op diff.
const formatted = spawnSync(
  process.execPath,
  [
    resolve(
      PACKAGE_ROOT,
      "..",
      "..",
      "node_modules",
      "prettier",
      "bin",
      "prettier.cjs"
    ),
    "--write",
    OUTPUT_PATH,
    REPORT_PATH,
  ],
  { encoding: "utf8" }
);
if (formatted.status !== 0) {
  throw new Error(
    `prettier failed on the generated artifact: ${formatted.stderr}`
  );
}

console.log(`\nWritten: ${OUTPUT_PATH}`);
console.log(`Written: ${REPORT_PATH}`);
console.log(`Divergences recorded: ${String(divergences.length)}`);
for (const divergence of divergences) {
  console.log(`  - ${divergence.subject}: ${divergence.finding}`);
}
