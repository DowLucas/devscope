import type { WorkflowIntentProfile } from "@devscope/shared";

/** A profile restricted to some set of sessions: the whole week, or one intent. */
export type ProfileSlice = Omit<WorkflowIntentProfile, "recovery_quality"> & {
  recovery_quality?: number | null;
};

export interface DimensionView {
  key: string;
  label: string;
  descriptors: [string, string];
  value: number | null;
  team: number | undefined;
  hint?: string;
}

const STATIC_DIMENSIONS = [
  { key: "iterative_vs_planning", label: "Iteration Style", descriptors: ["Planning-Heavy", "Highly Iterative"] },
  { key: "tool_diversity", label: "Tool Breadth", descriptors: ["Focused", "Diverse"] },
  { key: "recovery", label: "", descriptors: ["", ""] },
  { key: "session_depth", label: "Session Depth", descriptors: ["Short Sessions", "Deep Sessions"] },
  { key: "prompt_density", label: "Prompt Rhythm", descriptors: ["Sparse", "Dense"] },
  { key: "agent_usage", label: "Agent Leverage", descriptors: ["Manual", "Agent-Heavy"] },
] as const;

export const INTENT_LABELS: Record<string, string> = {
  debug: "Debugging",
  build: "Building",
  refactor: "Refactoring",
  doc: "Docs",
  review: "Review",
  exploration: "Exploration",
  tooling: "Tooling",
  other: "Other",
};

// NUMERIC columns arrive as strings; JSON slices arrive as numbers.
const num = (v: unknown): number | null =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * Resolve the six dimensions for a slice, paired with the matching team value.
 *
 * Recovery prefers the model-rated `recovery_quality` and falls back to the
 * timing heuristic when it is missing. The team value always comes from the
 * same source as the personal one, so the two never mix measures.
 */
export function buildDimensions(
  slice: ProfileSlice,
  team: Record<string, number> | undefined,
): DimensionView[] {
  const quality = num(slice.recovery_quality);
  return STATIC_DIMENSIONS.map((d) => {
    if (d.key === "recovery") {
      return quality != null
        ? {
            key: "recovery_quality",
            label: "Recovery",
            descriptors: ["Retries Unchanged", "Adapts After Failures"],
            value: quality,
            team: team?.recovery_quality,
            hint: "Share of failures after which the approach changed, judged by Jev from the tool sequence",
          }
        : {
            key: "recovery_speed",
            label: "Recovery Speed",
            descriptors: ["Methodical", "Quick Recovery"],
            value: num(slice.recovery_speed),
            team: team?.recovery_speed,
            hint: "Time from a failed call to the next successful one",
          };
    }
    return {
      key: d.key,
      label: d.label,
      descriptors: [...d.descriptors] as [string, string],
      value: num(slice[d.key as keyof ProfileSlice]),
      team: team?.[d.key],
    };
  });
}
