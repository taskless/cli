import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchema, type SchemaPolicy } from "../src/filesystem/directory";
import {
  classifySchema,
  LATEST_SCHEMA_VERSION,
  type SchemaState,
} from "../src/filesystem/migrate";
import { CLIError } from "../src/util/cli-error";

/**
 * Every (state × policy) pair `ensureSchema` can meet, and what it must do.
 *
 * The point of naming the policy is that a command's treatment of the scaffold
 * is a decision rather than an accident of which helper it called. This table
 * is that decision written down once, so a change to any cell is a visible
 * diff here rather than a behaviour change discovered in someone's repository.
 */

type Seed = "absent" | "behind" | "behind-no-manifest" | "current" | "ahead";

type Outcome =
  | { result: "untouched" }
  | { result: "scaffolded" }
  | { result: "migrated" }
  | {
      result: "throws";
      code: "SCAFFOLD_MIGRATION_REQUIRED" | "SCAFFOLD_VERSION_MISMATCH";
    };

const UNTOUCHED: Outcome = { result: "untouched" };
const MIGRATION_REQUIRED: Outcome = {
  result: "throws",
  code: "SCAFFOLD_MIGRATION_REQUIRED",
};
const VERSION_MISMATCH: Outcome = {
  result: "throws",
  code: "SCAFFOLD_VERSION_MISMATCH",
};

const TABLE: Record<Seed, Record<SchemaPolicy, Outcome>> = {
  absent: {
    migrate: { result: "scaffolded" },
    "scaffold-if-absent": { result: "scaffolded" },
    refuse: UNTOUCHED,
  },
  behind: {
    migrate: { result: "migrated" },
    "scaffold-if-absent": MIGRATION_REQUIRED,
    refuse: MIGRATION_REQUIRED,
  },
  // Keyed on the directory, not the manifest: no manifest is version 0.
  "behind-no-manifest": {
    migrate: { result: "migrated" },
    "scaffold-if-absent": MIGRATION_REQUIRED,
    refuse: MIGRATION_REQUIRED,
  },
  current: {
    migrate: UNTOUCHED,
    "scaffold-if-absent": UNTOUCHED,
    refuse: UNTOUCHED,
  },
  ahead: {
    migrate: VERSION_MISMATCH,
    "scaffold-if-absent": VERSION_MISMATCH,
    refuse: VERSION_MISMATCH,
  },
};

const EXPECTED_STATE: Record<Seed, SchemaState> = {
  absent: { kind: "absent" },
  behind: { kind: "behind", from: 3, to: LATEST_SCHEMA_VERSION },
  "behind-no-manifest": { kind: "behind", from: 0, to: LATEST_SCHEMA_VERSION },
  current: { kind: "current", version: LATEST_SCHEMA_VERSION },
  ahead: { kind: "ahead", version: 99, supported: LATEST_SCHEMA_VERSION },
};

/** The manifest version each seed writes; absent and no-manifest write none. */
const SEED_VERSION: Partial<Record<Seed, number>> = {
  behind: 3,
  current: LATEST_SCHEMA_VERSION,
  ahead: 99,
};

const SEEDS = Object.keys(TABLE) as Seed[];
const POLICIES: SchemaPolicy[] = ["migrate", "scaffold-if-absent", "refuse"];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("ensureSchema", () => {
  let directory: string;
  let taskless: string;
  const notices: string[] = [];
  const quiet = {
    onNotice: (message: string) => notices.push(message),
    allowVersionMismatches: false,
  };

  async function seed(state: Seed): Promise<void> {
    if (state === "absent") return;
    await mkdir(taskless, { recursive: true });
    const version = SEED_VERSION[state];
    if (version === undefined) return;
    await writeFile(
      join(taskless, "taskless.json"),
      JSON.stringify({ version, install: {} }),
      "utf8"
    );
  }

  async function manifestVersion(): Promise<number | undefined> {
    if (!(await exists(join(taskless, "taskless.json")))) return undefined;
    const manifest = JSON.parse(
      await readFile(join(taskless, "taskless.json"), "utf8")
    ) as { version: number };
    return manifest.version;
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "tskl-schema-policy-"));
    taskless = join(directory, ".taskless");
    notices.length = 0;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(SEEDS)("classifies a %s scaffold", async (state) => {
    await seed(state);
    await expect(classifySchema(directory)).resolves.toEqual(
      EXPECTED_STATE[state]
    );
  });

  const cases = SEEDS.flatMap((state) =>
    POLICIES.map((policy) => [state, policy, TABLE[state][policy]] as const)
  );

  it.each(cases)("%s × %s", async (state, policy, outcome) => {
    await seed(state);
    const before = await manifestVersion();

    if (outcome.result === "throws") {
      const error = await ensureSchema(directory, policy, quiet).catch(
        (error_: unknown) => error_
      );
      expect(error).toBeInstanceOf(CLIError);
      expect((error as CLIError).code).toBe(outcome.code);
      // A refusal changes nothing.
      expect(await manifestVersion()).toBe(before);
      expect(notices).toEqual([]);
      return;
    }

    const result = await ensureSchema(directory, policy, quiet);
    expect(result.state).toEqual(EXPECTED_STATE[state]);

    switch (outcome.result) {
      case "untouched": {
        expect(result.migrated).toBeUndefined();
        expect(await manifestVersion()).toBe(before);
        expect(await exists(taskless)).toBe(state !== "absent");
        break;
      }
      case "scaffolded":
      case "migrated": {
        expect(result.migrated).toBeDefined();
        expect(await manifestVersion()).toBe(LATEST_SCHEMA_VERSION);
        break;
      }
    }
  });

  it.each(POLICIES)(
    "an ahead scaffold proceeds untouched under %s with the override",
    async (policy) => {
      await seed("ahead");
      const result = await ensureSchema(directory, policy, {
        ...quiet,
        allowVersionMismatches: true,
      });
      expect(result).toEqual({ state: EXPECTED_STATE.ahead });
      expect(await manifestVersion()).toBe(99);
    }
  );
});
