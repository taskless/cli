import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextAskPath, readNextAsk, writeNextAsk } from "../src/survey/cadence";
import {
  ANSWERED_INTERVAL_MS,
  COMPLETED_CHOICES,
  SHOWN_INTERVAL_MS,
  SURVEY_ID,
  SURVEY_QUESTIONS,
  SURVEYED_TOPICS,
} from "../src/survey/constants";

describe("survey constants", () => {
  // The identifiers are PostHog's, transcribed once. A question's id changes
  // whenever the question does, which is exactly the kind of drift this pins:
  // the values here are what the 0.11.3 survey holds as of 2026-09-21.
  it("carries the live survey's question ids in question order", () => {
    expect(SURVEY_ID).toBe("01a0c7b9-dfe4-0000-d05e-ce253e90a68c");
    expect(SURVEY_QUESTIONS.map(({ key, id }) => [key, id])).toEqual([
      ["ruleKind", "0874591f-c554-4ac3-8930-e11c436d859e"],
      ["verbatim", "2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2"],
      ["completed", "605e12a8-82b6-480f-93b2-ab8de0fa08bd"],
      ["workedWell", "b5375d87-e295-4833-84ed-fca8140ba992"],
      ["needsImprovement", "a8cf706d-3ff7-4845-bea9-501013be958c"],
      ["agents", "f85b22df-8e51-4c9c-8219-261b33b71c90"],
      ["mostValuableRule", "4f8e938e-22f6-449c-9b8c-43c51d08e214"],
    ]);
  });

  it("holds PostHog's choices for the single-choice question, in its casing", () => {
    expect(COMPLETED_CHOICES).toEqual(["Yes", "No", "Unknown"]);
  });

  it("surveys the four authoring and onboarding recipes only", () => {
    expect([...SURVEYED_TOPICS].toSorted()).toEqual([
      "create-remote-rule",
      "create-sg-rule",
      "create-vale-rule",
      "onboard",
    ]);
  });

  it("holds an explicit answer off longer than a served invite", () => {
    expect(SHOWN_INTERVAL_MS).toBe(10 * 24 * 60 * 60 * 1000);
    expect(ANSWERED_INTERVAL_MS).toBe(20 * 24 * 60 * 60 * 1000);
  });
});

describe("survey cadence store", () => {
  let configHome: string;

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), "tskl-cadence-"));
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(configHome, { recursive: true, force: true });
  });

  it("lives under the survey id in the XDG config directory", () => {
    expect(nextAskPath(SURVEY_ID)).toBe(
      join(configHome, "taskless", "surveys", SURVEY_ID, "next_ask")
    );
  });

  it("reads absent as undefined", async () => {
    expect(await readNextAsk(SURVEY_ID)).toBeUndefined();
  });

  it("round-trips an epoch, truncated to whole milliseconds", async () => {
    const at = Date.now() + SHOWN_INTERVAL_MS;
    await writeNextAsk(SURVEY_ID, at + 0.75);
    expect(await readNextAsk(SURVEY_ID)).toBe(at);
    // A bare decimal string, nothing else, so a human can read it.
    expect(await readFile(nextAskPath(SURVEY_ID), "utf8")).toBe(String(at));
  });

  it("reads a corrupt file as undefined, and the next write repairs it", async () => {
    const path = nextAskPath(SURVEY_ID);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not a number\n", "utf8");
    expect(await readNextAsk(SURVEY_ID)).toBeUndefined();

    await writeNextAsk(SURVEY_ID, 1234);
    expect(await readNextAsk(SURVEY_ID)).toBe(1234);
  });

  it("keeps a different survey's cadence in its own file", async () => {
    await writeNextAsk(SURVEY_ID, 1000);
    expect(await readNextAsk("00000000-0000-4000-8000-000000000000")).toBe(
      undefined
    );
  });
});
