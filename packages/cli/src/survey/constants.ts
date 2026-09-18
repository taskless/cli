/**
 * The PostHog survey the CLI answers on the user's behalf, and the map from
 * the payload's human keys to its question identifiers.
 *
 * This is the ONLY place the survey's identifiers live. The agent never sees a
 * question UUID: it writes `verbatim`, `goal`, and so on, and `feedback send`
 * translates. A mangled UUID would be a silently missing answer; a mangled
 * human key is a validation error with a message.
 *
 * The identifiers are PostHog's. `survey shown`, `survey dismissed`, and
 * `survey sent` are its event literals for a custom survey, `$survey_id` and
 * `$survey_response_<question id>` are its property contract, and the CLI
 * adds no survey-specific property of its own. Everything else on the event
 * is the standard set the telemetry client stamps on every capture.
 *
 * `survey shown` means SERVED. The CLI knows it appended the invite to a
 * recipe; it cannot know the agent put the question to a person. The funnel
 * reads shown ≫ sent by design, and nothing here pretends otherwise.
 *
 * A question's id changes when its type changes in PostHog. Q3 became single
 * choice on 2026-09-17 and took a new id; the one below is current.
 */
export const SURVEY_ID = "01a0b1a0-80fb-0000-5dc1-baa4ec44e619";

/** The payload keys, in question order. */
export type FeedbackKey =
  | "verbatim"
  | "goal"
  | "completed"
  | "workedWell"
  | "needsImprovement";

export interface SurveyQuestion {
  key: FeedbackKey;
  id: string;
  question: string;
}

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    key: "verbatim",
    id: "5feff6a3-6768-4817-92d7-5ae3975c6baa",
    question: "What was the user's comments verbatim?",
  },
  {
    key: "goal",
    id: "561e87f4-a1b7-4855-b728-29d19421f7e7",
    question: "What was the user trying to accomplish?",
  },
  {
    key: "completed",
    id: "6ebdfabb-3575-49aa-857c-47b6bbfdebc8",
    question: "Did the user successfully complete the task in your opinion?",
  },
  {
    key: "workedWell",
    id: "2316428e-dc3e-4c96-ae67-a6e8c66d7db5",
    question: "What steps of the interaction with Taskless worked well?",
  },
  {
    key: "needsImprovement",
    id: "67bedbd9-ca70-4c1c-b1a6-6df830a453dd",
    question:
      "What steps of the interaction with Taskless could use improvement?",
  },
];

/** The choices PostHog holds for `completed`, in its own casing. */
export const COMPLETED_CHOICES = ["Yes", "No", "Unknown"] as const;

/**
 * The recipes that carry the invite. Used by the gate alone; the events do not
 * name the recipe, because the survey contract has no slot for it.
 */
export const SURVEYED_TOPICS: ReadonlySet<string> = new Set([
  "onboard",
  "create-sg-rule",
  "create-vale-rule",
  "create-remote-rule",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long serving an invite holds the next one off. Ten days, because the
 * surveyed recipes are rule generation, which is the touchiest part of the
 * agent experience, and a long quiet gap is a gap in feedback.
 */
export const SHOWN_INTERVAL_MS = 10 * DAY_MS;

/**
 * How long an explicit answer holds the next invite off. Twenty days for both
 * a dismissal and a sent response: either is a terminal action the user took,
 * and only silence earns the shorter gap.
 */
export const ANSWERED_INTERVAL_MS = 20 * DAY_MS;
