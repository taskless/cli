import { getRecipe } from "../prompts/recipes";
import { getTelemetry, isTelemetryEnabled } from "../telemetry";
import { isCiEnvironment } from "../util/interactive";
import { readNextAsk, writeNextAsk } from "./cadence";
import { SHOWN_INTERVAL_MS, SURVEY_ID, SURVEYED_TOPICS } from "./constants";

/** The fragment appended to a surveyed recipe; see `src/agent/feedback-invite.md`. */
const INVITE_TOPIC = "feedback-invite";

export interface InviteContext {
  /** The rendered recipe as the command is about to print it. */
  recipe: string;
  /** The topic that was served, which decides whether it is surveyed. */
  topic: string;
  /** The invocation the recipe was rendered with, so the invite matches it. */
  invocation: string | undefined;
  /** Working directory, for the telemetry client. */
  cwd: string;
  /** `process.env.CI`, passed in so the gate is testable without stubbing. */
  ci?: string | undefined;
  /** The clock, overridable in tests. */
  now?: () => number;
}

/**
 * Whether the invite may be served right now.
 *
 * Every condition is a reason NOT to ask, checked cheapest first:
 *
 * - Telemetry off. The invite has nowhere to send an answer, so serving it
 *   would ask the user for words the CLI then throws away. This is also what
 *   keeps the byte-parity test between `agent <topic>` and the prompts export
 *   honest: the suite runs with the opt-out set.
 * - CI. Telemetry is NOT off in CI (`cli_check_completed` from a runner is
 *   real signal), but a survey there has no one to answer it.
 * - An unsurveyed topic. The set is the authoring and onboarding recipes,
 *   which are where an agent-driven session most often goes wrong.
 * - The cadence. `next_ask` is the earliest time the next invite may be
 *   served; absent or unparseable reads as "now", and the write that follows
 *   repairs a corrupt file.
 */
export async function surveyGateIsOpen(
  context: Pick<InviteContext, "topic" | "ci" | "now">
): Promise<boolean> {
  if (!isTelemetryEnabled()) return false;
  if (isCiEnvironment(context.ci)) return false;
  if (!SURVEYED_TOPICS.has(context.topic)) return false;
  const nextAsk = await readNextAsk(SURVEY_ID);
  const now = (context.now ?? Date.now)();
  return nextAsk === undefined || nextAsk <= now;
}

/**
 * The text a recipe-serving command prints: the recipe alone when the gate is
 * closed, the recipe plus the invite when it is open.
 *
 * Serving the invite is the `survey shown` moment. The CLI knows it appended
 * the question; it cannot know the agent put it to a person, so the funnel
 * reads shown ≫ sent by design (see `constants.ts`). The cadence is written
 * here too, at show time, so an invite the agent never surfaces still holds
 * the next one off: silence earns the short gap, an answer the long one.
 *
 * The cadence is written the moment the gate opens, before the fragment is
 * rendered and before the telemetry client is initialised. Nothing locks the
 * file, so two CLI processes that read `next_ask` in the same instant can both
 * see the gate open and both serve the invite. Writing first makes that window
 * the width of one read-then-write rather than a recipe render and a telemetry
 * init. The worst case is one duplicate invite and one duplicate `survey
 * shown`, and the funnel already over-counts shown by design, so this is an
 * accepted tradeoff. A lock file was considered and rejected: it would need a
 * TTL to survive a crashed process, which is more mechanism than one duplicate
 * invite earns.
 *
 * Appended after the recipe's last section rather than parsed into it. Agents
 * attend to the start and end of a response, and the end puts the ask after
 * the task rather than in front of it. The `prompts` export never sees this:
 * it is a fetch-time concern of the two commands that serve recipes, and the
 * render path stays pure.
 */
export async function withSurveyInvite(
  context: InviteContext
): Promise<string> {
  const recipe = context.recipe.trimEnd();
  if (!(await surveyGateIsOpen(context))) return recipe;

  // Claim the window first; see the note above on the read-then-write race.
  const now = (context.now ?? Date.now)();
  await writeNextAsk(SURVEY_ID, now + SHOWN_INTERVAL_MS);

  const invite = getRecipe(INVITE_TOPIC, {
    invocation: context.invocation,
    header: false,
  });
  // The fragment is embedded at build time; its absence is a build defect,
  // and serving the recipe without it is the right failure. The cadence has
  // already been advanced by then, which is fine: a missing fragment is not
  // a reason to ask again sooner.
  if (invite === undefined) return recipe;

  const telemetry = await getTelemetry(context.cwd);
  telemetry.capture("survey shown", { $survey_id: SURVEY_ID });

  return `${recipe}\n\n${invite.trimEnd()}`;
}
