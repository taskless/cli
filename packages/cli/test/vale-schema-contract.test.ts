import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";

import { findValeBinary } from "../src/rules/vale/binary";
import { VALE_VERSION } from "../src/rules/capabilities";
import {
  VALE_CHECK_TYPES,
  VALE_PERMISSIVE_CHECKS,
  validateValeRule,
} from "../src/schemas/vale-rule";
import {
  REACH_PROBE,
  VALE_CORPUS,
  type ValeCorpusEntry,
  type ValeVerdict,
} from "./vale-corpus";

/**
 * The differential that makes `src/schemas/vale-rule.ts` true.
 *
 * The schema is a hand transcription of a vendored binary's accepted values,
 * because Vale publishes no JSON Schema and its machine-readable field
 * knowledge is behind a paid hosted MCP. A transcription is worth exactly what
 * holds it to the thing transcribed, and that is this file: for every row of
 * `vale-corpus.ts`, run the rule through the binary and through the schema and
 * assert the two agree.
 *
 * Both directions of disagreement fail, and they are reported separately
 * because they mean different things:
 *
 * - **Schema too lax** — a rule the binary will not honor verifies clean. That
 *   is the gap this change exists to close.
 * - **Schema too strict** — a rule the binary accepts is rejected. Worse: it
 *   blocks work that would have functioned.
 *
 * Like `vale-vendor-contract.test.ts`, this invokes the vendored binary
 * directly rather than through `runVale`. A test that went through the wrapper
 * would be asserting our interpretation of Vale, which is the thing under test
 * everywhere else.
 */

const binary = findValeBinary().path;
const withVale = binary === undefined ? describe.skip : describe;

/** Where the corpus rule id lands, and therefore what `verify` would call it. */
const RULE_ID = "corpus";

function runOne(rule: string, control: string, extension: string): ValeVerdict {
  const cwd = mkdtempSync(join(tmpdir(), "vale-corpus-"));
  try {
    mkdirSync(join(cwd, "styles", RULE_ID), { recursive: true });
    writeFileSync(join(cwd, "styles", RULE_ID, `${RULE_ID}.yml`), rule);
    writeFileSync(
      join(cwd, ".vale.ini"),
      // `BasedOnStyles =` is load-bearing: without it a control could trip a
      // bundled style and be read as the rule under test firing.
      `StylesPath = styles\nMinAlertLevel = suggestion\n\n[*]\nBasedOnStyles =\n${RULE_ID}.${RULE_ID} = YES\n`
    );
    writeFileSync(join(cwd, `doc.${extension}`), control);

    const result = spawnSync(
      binary as string,
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

    // `--no-exit` suppresses the exit code Vale returns merely for *finding*
    // something. A non-zero status therefore means the config itself failed —
    // `E201`, an unknown `extends`, a bad `level`. That is `rejected`.
    if (result.status !== 0) return "rejected";

    const payload: unknown = JSON.parse(result.stdout || "{}");
    // The error shape is an array; the finding shape is a map of file to
    // findings. A parsed array here means Vale reported a problem while still
    // exiting zero, which is still a rejection.
    if (Array.isArray(payload)) return "rejected";

    const findings = Object.values(payload as Record<string, unknown[]>).flat();
    return findings.length > 0 ? "accepted" : "ignored";
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

interface Measured {
  entry: ValeCorpusEntry;
  /** What the binary did with the rule under test. */
  binary: ValeVerdict;
  /** Whether the reach probe fired on the control at all. */
  reach: ValeVerdict;
  /** Whether the known-valid variant fired, for `ignored` rows. */
  proof?: ValeVerdict;
}

const measured: Measured[] = [];

withVale("Vale schema contract", () => {
  beforeAll(() => {
    for (const entry of VALE_CORPUS) {
      const extension = entry.ext ?? "md";
      measured.push({
        entry,
        binary: runOne(entry.rule, entry.control, extension),
        reach: runOne(REACH_PROBE, entry.control, extension),
        ...(entry.proof === undefined
          ? {}
          : { proof: runOne(entry.proof, entry.control, extension) }),
      });
    }
  }, 120_000);

  describe("the corpus is not vacuous", () => {
    it("has a row for every check type the schema enumerates", () => {
      // A check type with no row is a value the schema asserts and nothing
      // measured. This is also the version-bump tripwire: a Vale release that
      // renames or drops a check type fails here, naming it.
      const covered = new Set(
        VALE_CORPUS.flatMap((entry) => {
          const match = /^extends: (\w+)$/.exec(entry.construct);
          return match === null ? [] : [match[1]];
        })
      );
      for (const check of VALE_CHECK_TYPES) {
        expect(covered, `no corpus row extends ${check}`).toContain(check);
      }
    });

    it("reaches every control document", () => {
      // The guard against a row that passes because Vale never linted the
      // fixture at all — wrong extension, unparseable format, unmatched glob.
      // Without it, `ignored` cannot be told apart from "not linted", and an
      // entry asserts nothing while looking green.
      for (const { entry, reach } of measured) {
        expect(
          reach,
          `${entry.name}: the reach probe did not fire on this control, so ` +
            `its verdict says nothing about ${entry.construct}`
        ).toBe("accepted");
      }
    });

    it("attributes every `ignored` verdict to its construct", () => {
      // A control with no table would make `scope: table.cell` read `ignored`
      // for a perfectly valid scope. The proof is the same rule with the
      // construct replaced by a known-valid one: if it fires and the entry does
      // not, the difference is the construct.
      for (const { entry, proof } of measured) {
        if (entry.expected !== "ignored") continue;
        expect(
          entry.proof,
          `${entry.name}: an \`ignored\` row needs a proof rule`
        ).toBeDefined();
        expect(
          entry.proof,
          `${entry.name}: the proof must differ from the rule under test`
        ).not.toBe(entry.rule);
        expect(
          proof,
          `${entry.name}: the known-valid variant did not fire either, so ` +
            `"did not fire" is not attributable to ${entry.construct}`
        ).toBe("accepted");
      }
    });

    it("has a unique name per row", () => {
      const names = VALE_CORPUS.map((entry) => entry.name);
      expect(new Set(names).size, "duplicate corpus row name").toBe(
        names.length
      );
    });
  });

  describe("the binary still does what the corpus recorded", () => {
    it("agrees with every recorded verdict", () => {
      // Vale 3.18.0 is pinned. When VALE_VERSION is raised and a construct's
      // treatment changed, this is where it surfaces — naming the construct
      // rather than leaving the schema quietly wrong.
      const drift = measured
        .filter(({ entry, binary: verdict }) => verdict !== entry.expected)
        .map(
          ({ entry, binary: verdict }) =>
            `${entry.name} (${entry.construct}): recorded ${entry.expected}, ` +
            `Vale ${VALE_VERSION} says ${verdict}`
        );
      expect(drift, drift.join("\n")).toEqual([]);
    });
  });

  describe("the schema agrees with the binary", () => {
    it("is not too lax: every rule the binary will not honor is rejected", () => {
      const tooLax = measured
        .filter(({ entry, binary: verdict }) => {
          if (entry.divergence !== undefined) return false;
          return (
            verdict !== "accepted" &&
            validateValeRule(RULE_ID, parse(entry)).valid
          );
        })
        .map(
          ({ entry, binary: verdict }) =>
            `${entry.name}: Vale ${verdict} ${entry.construct}, schema accepted it`
        );
      expect(tooLax, tooLax.join("\n")).toEqual([]);
    });

    it("is not too strict: every rule the binary honors is accepted", () => {
      // The worse direction. A schema that rejects a working rule blocks work
      // that would have functioned, which is a bigger cost than the gap it was
      // added to close.
      const tooStrict = measured
        .filter(({ entry, binary: verdict }) => {
          if (entry.divergence !== undefined) return false;
          return (
            verdict === "accepted" &&
            !validateValeRule(RULE_ID, parse(entry)).valid
          );
        })
        .map(({ entry }) => {
          const { errors } = validateValeRule(RULE_ID, parse(entry));
          return `${entry.name}: Vale honors ${entry.construct}, schema said: ${errors.join("; ")}`;
        });
      expect(tooStrict, tooStrict.join("\n")).toEqual([]);
    });

    it("diverges only where a row says so, and says why", () => {
      // The carve-outs are countable rather than silent. A row claiming a
      // divergence that no longer exists fails here too.
      for (const { entry, binary: verdict } of measured) {
        if (entry.divergence === undefined) continue;
        const schemaAccepts = validateValeRule(RULE_ID, parse(entry)).valid;
        expect(
          schemaAccepts,
          `${entry.name} claims a divergence but agrees with Vale`
        ).not.toBe(verdict === "accepted");
        expect(entry.divergence.length).toBeGreaterThan(40);
      }
    });
  });

  describe("errors an author can act on", () => {
    it("names the field and the accepted values for an unknown extends", () => {
      const { errors } = validateValeRule(
        "demo",
        parseYaml('extends: nonsense\nmessage: "x"\n')
      );
      expect(errors.join("\n")).toContain("extends");
      for (const check of VALE_CHECK_TYPES) {
        expect(errors.join("\n")).toContain(check);
      }
    });

    it("names the field and the accepted operands for an unknown scope", () => {
      const { errors } = validateValeRule(
        "demo",
        parseYaml(
          'extends: existence\nmessage: "x"\nscope: fenced\ntokens: [a]\n'
        )
      );
      expect(errors.join("\n")).toContain("scope");
      expect(errors.join("\n")).toContain("fenced");
      expect(errors.join("\n")).toContain("heading.h1");
    });

    it("names the check when a field belongs to another one", () => {
      const { errors } = validateValeRule(
        "demo",
        parseYaml(
          'extends: occurrence\nmessage: "x"\ntoken: a\nmax: 1\ntokens: [a]\n'
        )
      );
      expect(errors.join("\n")).toContain("tokens");
      expect(errors.join("\n")).toContain("occurrence");
      expect(errors.join("\n")).toContain("E201");
    });
  });
});

/**
 * The exemption, stated as a test rather than only as a comment.
 *
 * `consistency` and `spelling` are the two checks Vale loads without a strict
 * field decode, so a foreign key on either is ignored instead of raising
 * `E201`. The schema follows the binary and leaves those two loose. That is a
 * deliberate hole in the `E201` net, and a hole is worth a test: without one,
 * a later pass could add a field table for either check, tighten it to match
 * the docs, and turn "Vale ignores this" into a rule the schema rejects and
 * Vale runs. This needs no binary; it asks what the schema does.
 */
describe("the permissive checks stay permissive", () => {
  it("accepts a foreign field on every permissive check", () => {
    for (const check of VALE_PERMISSIVE_CHECKS) {
      const { valid, errors } = validateValeRule(
        "demo",
        parseYaml(unknownField(check))
      );
      expect(
        valid,
        `${check} rejected a foreign field: ${errors.join("; ")}`
      ).toBe(true);
    }
  });

  it("rejects a foreign field on every other check", () => {
    const permissive = new Set<string>(VALE_PERMISSIVE_CHECKS);
    for (const check of VALE_CHECK_TYPES) {
      if (permissive.has(check)) continue;
      const { errors } = validateValeRule(
        "demo",
        parseYaml(unknownField(check))
      );
      expect(errors.join("\n"), `${check} accepted a foreign field`).toContain(
        "'bananafield' is not a field"
      );
    }
  });
});

// --- Helpers -----------------------------------------------------------------

/**
 * The corpus stores rules as YAML text, because that is what Vale reads and
 * what an author writes. The schema takes the parsed value, exactly as
 * `verifyOneRule` hands it over.
 */
function parseYaml(source: string): unknown {
  return yamlParse(source) as unknown;
}

function parse(entry: ValeCorpusEntry): unknown {
  return parseYaml(entry.rule);
}

/** A minimal rule of `check` carrying one field that belongs to no check. */
function unknownField(check: string): string {
  return `extends: ${check}\nmessage: "x"\nbananafield: true\n`;
}
