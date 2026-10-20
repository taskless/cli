import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS_TONE } from "../src/install/settings-tone";

let level: typeof chalk.level;

beforeEach(() => {
  level = chalk.level;
  chalk.level = 1;
});

afterEach(() => {
  chalk.level = level;
});

describe("settings edit colours", () => {
  it("is green for an addition, plain for a removal, yellow for a replacement, and red only for a skip", () => {
    expect(SETTINGS_TONE.allow("ALLOW")).toBe(chalk.green("ALLOW"));
    expect(SETTINGS_TONE.remove("REMOVE")).toBe("REMOVE");
    expect(SETTINGS_TONE.replace("REPLACE")).toBe(chalk.yellow("REPLACE"));
    expect(SETTINGS_TONE.skip("SKIPPED")).toBe(chalk.red("SKIPPED"));
  });
});
