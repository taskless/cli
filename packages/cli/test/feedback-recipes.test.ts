import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { getRecipe } from "../src/prompts/recipes";
import { inputSchema } from "../src/schemas/feedback";
import { COMPLETED_CHOICES } from "../src/survey/constants";

const execFileAsync = promisify(execFile);
const binPath = resolve(import.meta.dirname, "../dist/index.js");
const invocation = "npx @taskless/cli";

/** The sentence the invite puts to the user, as the design fixed it. */
const ASK =
  "Taskless would like to know how this went. Anything you'd like to add in your own words? Reply `skip` if not, and I'll send my own notes on the session.";

/** Blockquote prose, unwrapped: the recipe hard-wraps and prefixes `> `. */
function unwrapQuote(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2).trim())
    .join(" ");
}

describe("the feedback recipe", () => {
  it("opens with its header and embeds the payload schema", async () => {
    const { stdout } = await execFileAsync("node", [
      binPath,
      "agent",
      "feedback",
    ]);
    expect(stdout.startsWith("# Topic: feedback ")).toBe(true);
    // The schema is rendered from the Zod source, so the choices the agent
    // reads are the ones `feedback send` accepts.
    for (const choice of COMPLETED_CHOICES) {
      expect(stdout).toContain(`"${choice}"`);
    }
    for (const key of Object.keys(inputSchema.shape)) {
      expect(stdout).toContain(`"${key}"`);
    }
  });

  it("names the send and dismiss commands by the rendered invocation", () => {
    const rendered = getRecipe("feedback", { invocation });
    expect(rendered).toContain(
      `${invocation} feedback send --from .taskless/.tmp-feedback.json --json`
    );
    expect(rendered).toContain(`${invocation} feedback dismiss`);
  });

  it("tells the agent it is the respondent and hands the user's words through verbatim", () => {
    const rendered = getRecipe("feedback", { invocation }) ?? "";
    expect(rendered).toContain("You are the respondent");
    expect(rendered).toContain(
      "Do not put the survey's questions to the user one by one"
    );
    expect(rendered).toContain("Do NOT edit the user's words");
  });
});

describe("the feedback invite", () => {
  it("renders header-less as the fragment the gate appends", () => {
    const fragment = getRecipe("feedback-invite", {
      invocation,
      header: false,
    });
    expect(fragment).toBeDefined();
    expect(fragment).not.toContain("# Topic:");
    expect(fragment?.startsWith("## Before you finish")).toBe(true);
  });

  it("puts the fixed sentence to the user, once", () => {
    const fragment =
      getRecipe("feedback-invite", {
        invocation,
        header: false,
      }) ?? "";
    expect(unwrapQuote(fragment)).toBe(ASK);
    expect(fragment).toContain("Ask once");
  });

  it("names both doors by the rendered invocation", () => {
    const fragment =
      getRecipe("feedback-invite", {
        invocation,
        header: false,
      }) ?? "";
    expect(fragment).toContain(`${invocation} agent feedback`);
    expect(fragment).toContain(`${invocation} feedback dismiss`);
  });

  it("sends the agent's account on skip, silence, or an unrelated reply", () => {
    const fragment =
      getRecipe("feedback-invite", { invocation, header: false }) ?? "";
    const skipDoor = fragment.slice(
      fragment.indexOf("`skip`, said nothing, or replied about something else"),
      fragment.indexOf("They asked you not to send anything")
    );
    expect(skipDoor).toContain(`${invocation} agent feedback`);
    expect(skipDoor).toContain("no `verbatim`");
    expect(skipDoor).not.toContain("feedback dismiss");
  });

  it("reserves dismiss for an explicit refusal and names the telemetry switch", () => {
    const fragment =
      getRecipe("feedback-invite", { invocation, header: false }) ?? "";
    const refusal = fragment.slice(
      fragment.indexOf("They asked you not to send anything")
    );
    expect(refusal).toContain(`${invocation} feedback dismiss`);
    expect(refusal).toContain("DO_NOT_TRACK=1");
    expect(refusal).toContain("TASKLESS_TELEMETRY_DISABLED=1");
  });
});
