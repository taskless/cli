import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { getRecipe } from "../src/prompts/recipes";
import { ruleInputSchema } from "../src/schemas/feedback";
import { COMPLETED_CHOICES } from "../src/survey/constants";
import { builtCli } from "./support/built-cli";

const execFileAsync = promisify(execFile);
const binPath = builtCli();
const invocation = "npx @taskless/cli";

/** The sentence the invite puts to the user, as the design fixed it. */
const ASK =
  "Taskless would like to know how this went. Anything you'd like to add in your own words? Reply `skip` if not, and I'll send my own notes on the session, or `review` to see what I'd send before it goes.";

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
    for (const key of Object.keys(ruleInputSchema.shape)) {
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

  it("shows every answer before sending when the user asked for a review", () => {
    const rendered = getRecipe("feedback", { invocation }) ?? "";
    const review = rendered.slice(
      rendered.indexOf("**Show it first, if the user asked for a `review`.**"),
      rendered.indexOf("**Send.** Run:")
    );
    expect(review).toContain("Put every answer in the payload in the chat");
    expect(review).toContain("anything corrected before you send it");
    // Corrections loop: each round is shown again, and only the user ends it.
    expect(review).toContain("show the corrected payload in full");
    expect(review).toContain("Repeat until the user is satisfied");
    // A change of heart at the review is a refusal, handled like one.
    expect(review).toContain(`${invocation} feedback dismiss`);
    // The review precedes the send, so nothing leaves unseen.
    expect(rendered.indexOf("**Show it first")).toBeLessThan(
      rendered.indexOf(`${invocation} feedback send`)
    );
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

  it("offers a review that shows the answers before anything is sent", () => {
    const fragment =
      getRecipe("feedback-invite", { invocation, header: false }) ?? "";
    const reviewDoor = fragment.slice(
      fragment.indexOf("They said `review`"),
      fragment.indexOf("`skip`, said nothing, or replied about something else")
    );
    expect(reviewDoor).toContain(`${invocation} agent feedback`);
    expect(reviewDoor).toContain("review mode");
    expect(reviewDoor).not.toContain("feedback dismiss");
  });

  it("checks for a review before treating a reply as plain feedback", () => {
    const fragment =
      getRecipe("feedback-invite", { invocation, header: false }) ?? "";
    // A reply carrying both words and `review` must reach the review door,
    // so it is listed, and named as the first check, ahead of plain feedback.
    expect(fragment.indexOf("They said `review`")).toBeLessThan(
      fragment.indexOf("They gave feedback")
    );
    expect(fragment).toContain("Check for this first");
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
