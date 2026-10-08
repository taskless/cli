/**
 * The PostHog surveys the CLI answers on the user's behalf, and the map from
 * each payload's human keys to the survey's question identifiers.
 *
 * This is the ONLY place the surveys' identifiers live. The agent never sees a
 * question UUID: it writes `verbatim`, `summary`, and so on, and `feedback
 * send` translates. A mangled UUID would be a silently missing answer; a
 * mangled human key is a validation error with a message.
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
 * Three surveys, selected by the payload's `kind`:
 *
 * - `rule` is the invited survey about rule authoring and onboarding. It is
 *   the only one with an invite, a cadence, and a dismissal. It replaced
 *   `01a0b1a0-80fb-0000-5dc1-baa4ec44e619` for 0.12.0, and the cadence store
 *   is keyed by survey id, so that move invited every install once more.
 * - `general` is feedback the user chose to give.
 * - `bug` is a bug report. It is how a user without a GitHub account reaches
 *   the team. Its version-information question has no payload key: the CLI
 *   answers it itself (see `bugVersionInformation` in `commands/feedback.ts`).
 *
 * A question's id is PostHog's and changes whenever the question does.
 */
export const FEEDBACK_KINDS = ["rule", "general", "bug"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface SurveyQuestion {
  /** The payload key that answers it, or `undefined` when the CLI does. */
  key: string | undefined;
  id: string;
  question: string;
}

export interface Survey {
  id: string;
  questions: readonly SurveyQuestion[];
}

export const SURVEYS: Readonly<Record<FeedbackKind, Survey>> = {
  rule: {
    id: "01a0c7b9-dfe4-0000-d05e-ce253e90a68c",
    questions: [
      {
        key: "ruleKind",
        id: "0874591f-c554-4ac3-8930-e11c436d859e",
        question: "What kind of rule was the user trying to create?",
      },
      {
        key: "verbatim",
        id: "2c3c80dc-dcda-4e29-b52e-a25ef58b5ca2",
        question:
          "Did the user offer any comments? (leave blank if no comments)",
      },
      {
        key: "completed",
        id: "605e12a8-82b6-480f-93b2-ab8de0fa08bd",
        question:
          "Did the user successfully complete the task in your opinion?",
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
    ],
  },
  general: {
    id: "01a11da4-3948-0000-4ae4-c9da9321801e",
    questions: [
      {
        key: "verbatim",
        id: "c71e52ee-f4c7-469f-815a-af50a9be6d37",
        question: "Feedback",
      },
      {
        key: "context",
        id: "ab0ceb25-8084-44c8-9974-1d1a1c7371c2",
        question: "Attach any additional context",
      },
    ],
  },
  bug: {
    id: "01a11da7-27a2-0000-0f4e-6d3e1f89f385",
    questions: [
      {
        key: "summary",
        id: "2dd63cf3-dac2-4765-ace0-393bc4aa42fe",
        question: "One Line Summary",
      },
      {
        key: undefined,
        id: "ba096b81-ae5c-45b5-b15a-707f97129839",
        question: "Version Information (taskless info and cli version)",
      },
      {
        key: "trying",
        id: "e59a87e9-9ac7-4a59-a709-a282b16dbf37",
        question: "What were you trying to do?",
      },
      {
        key: "expected",
        id: "73415b80-7371-4536-8c50-09c2ecaa5d52",
        question: "What was the expected result?",
      },
      {
        key: "actual",
        id: "daa98d8d-113e-4e3e-ac0f-595ecc1fc69f",
        question: "What was the actual result?",
      },
      {
        key: "context",
        id: "597381f5-52e9-4937-bf80-dc55739e7435",
        question:
          "Any additional information or context that can help in fixing this issue",
      },
    ],
  },
};

/**
 * The invited survey, by name. The invite, its gate, the cadence, and
 * `feedback dismiss` all mean this survey specifically, and spelling it
 * `SURVEYS.rule.id` at each of those sites would hide that.
 */
export const RULE_SURVEY_ID = SURVEYS.rule.id;

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
