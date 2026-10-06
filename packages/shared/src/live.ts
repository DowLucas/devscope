// DevScope Live API types (/api/live), served to the devscope-live mod.
// Suggestions are attributed to sessions and projects only, never developers.

/** An active team skill, for matching typed prompts against its triggers. */
export interface LiveTeamSkill {
  id: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  /** The rendered SKILL.md. */
  content: string;
}

/** A friction nudge the event ingestion recorded for a session. */
export interface LiveNudge {
  /** The friction rule that tripped (e.g. `repeated_failure`). */
  rule: string;
  severity: string;
  message: string;
}

export type TurnLabel = "up" | "partial" | "down";

/** A next prompt that worked in a similar session. */
export interface NextPromptSuggestion {
  /** Up to 500 characters. */
  text: string;
  project: string;
  sessionTitle: string | null;
  toolCalls: number;
  /** The session owner's label on that turn, if any. */
  label: TurnLabel | null;
}
