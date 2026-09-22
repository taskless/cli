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
 * A question's id is PostHog's and changes whenever the question does. The
 * survey below replaced `01a0b1a0-80fb-0000-5dc1-baa4ec44e619` for 0.11.3:
 * seven questions, only the first required, every id new. The cadence store
 * is keyed by survey id, so every install is invited once more.
 */
export const SURVEY_ID = "01a0c7b9-dfe4-0000-d05e-ce253e90a68c";

/** The payload keys, in question order. */
export type FeedbackKey =
  | "ruleKind"
  | "verbatim"
  | "completed"
  | "workedWell"
  | "needsImprovement"
  | "agents"
  | "mostValuableRule";

export interface SurveyQuestion {
  key: FeedbackKey;
  id: string;
  question: string;
}

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    key: "ruleKind",
    id: "0874591f-c554-4ac3-8930-e11c436d859e",
    question: "What kind of rule was the user trying to create?",
  },
  {
    key: "verbatim",
    id: "2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2",
    question: "Did the user offer any comments? (leave blank if no comments)",
  },
  {
    key: "completed",
    id: "605e12a8-82b6-480f-93b2-ab8de0fa08bd",
    question: "Did the user successfully complete the task in your opinion?",
  },
  {
    key: "workedWell",
    id: "b5375d87-e295-4833-84ed-fca8140ba992",
    question:
      "What steps of the interaction with the Taskless skills & CLI worked well?",
  },
  {
    key: "needsImprovement",
    id: "a8cf706d-3ff7-4845-bea9-501013be958c",
    question:
      "What steps of the interaction with Taskless skills & CLI could use improvement?",
  },
  {
    key: "agents",
    id: "f85b22df-8e51-4c9c-8219-261b33b71c90",
    question:
      "What agent(s) or framework(s) is the user using that are open sourced and publicly available?",
  },
  {
    key: "mostValuableRule",
    id: "4f8e938e-22f6-449c-9b8c-43c51d08e214",
    question:
      "Of the rules created so far, what rule is creating the most value for the team and why? (leave blank if there are no rules)",
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
