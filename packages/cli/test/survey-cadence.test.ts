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
  // The identifiers are PostHog's, transcribed once. Q3's id changed when the
  // question became single choice, which is exactly the kind of drift this
  // pins: the value here is what the live survey holds as of 2026-09-17.
  it("carries the live survey's question ids in question order", () => {
    expect(SURVEY_ID).toBe("01a0b1a0-80fb-0000-5dc1-baa4ec44e619");
    expect(SURVEY_QUESTIONS.map(({ key, id }) => [key, id])).toEqual([
      ["verbatim", "5feff6a3-6768-4817-92d7-5ae3975c6baa"],
      ["goal", "561e87f4-a1b7-4855-b728-29d19421f7e7"],
      ["completed", "6ebdfabb-3575-49aa-857c-47b6bbfdebc8"],
      ["workedWell", "2316428e-dc3e-4c96-ae67-a6e8c66d7db5"],
      ["needsImprovement", "67bedbd9-ca70-4c1c-b1a6-6df830a453dd"],
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
