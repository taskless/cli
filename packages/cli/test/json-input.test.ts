import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { inputSchema as createInputSchema } from "../src/schemas/rules-create";
import { readJsonInput } from "../src/util/json-input";

describe("readJsonInput", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "taskless-json-input-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("names the resolved path and the reason when the file is missing", async () => {
    const filePath = join(temporaryDirectory, "missing.json");
    await expect(readJsonInput(filePath, z.unknown())).rejects.toThrow(
      `Could not read file "${filePath}": ENOENT: no such file or directory`
    );
  });

  it("tells a directory apart from a missing file", async () => {
    await expect(
      readJsonInput(temporaryDirectory, z.unknown())
    ).rejects.toThrow("EISDIR");
  });

  it("carries the parser's message when the file is not JSON", async () => {
    const filePath = join(temporaryDirectory, "bad.json");
    await writeFile(filePath, "not json at all");
    await expect(readJsonInput(filePath, z.unknown())).rejects.toThrow(
      `"${filePath}" is not valid JSON: Unexpected token`
    );
  });

  it("names every failing field path", async () => {
    const filePath = join(temporaryDirectory, "request.json");
    await writeFile(filePath, JSON.stringify({ successCases: [1] }));
    await expect(readJsonInput(filePath, createInputSchema)).rejects.toThrow(
      "Invalid input: prompt: expected string, received undefined; successCases.0: expected string, received number"
    );
  });

  it("passes a custom message through unchanged", async () => {
    const filePath = join(temporaryDirectory, "empty.json");
    await writeFile(filePath, JSON.stringify({ prompt: " " }));
    await expect(readJsonInput(filePath, createInputSchema)).rejects.toThrow(
      "Invalid input: prompt: prompt must be a non-empty string"
    );
  });

  it("labels an issue on the whole document as the payload", async () => {
    const filePath = join(temporaryDirectory, "array.json");
    await writeFile(filePath, "[]");
    await expect(readJsonInput(filePath, createInputSchema)).rejects.toThrow(
      "Invalid input: payload: "
    );
  });

  it("returns the parsed value when the request is valid", async () => {
    const filePath = join(temporaryDirectory, "ok.json");
    await writeFile(filePath, JSON.stringify({ prompt: "no console.log" }));
    await expect(readJsonInput(filePath, createInputSchema)).resolves.toEqual(
      expect.objectContaining({ prompt: "no console.log" })
    );
  });
});
