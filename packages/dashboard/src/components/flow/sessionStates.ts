import type { SessionActivityState } from "./flowTypes";

/** Badge, border and pulse per session state, shared by the node and the detail panel. */
export const STATE_CONFIG: Record<SessionActivityState, {
  label: string;
  badgeClass: string;
  borderColor: string;
  pulse: boolean;
}> = {
  running: {
    label: "Running",
    badgeClass: "bg-amber-500/15 text-amber-400",
    borderColor: "rgba(245, 158, 11, 0.4)",
    pulse: true,
  },
  thinking: {
    label: "Thinking",
    badgeClass: "bg-blue-500/15 text-blue-400",
    borderColor: "rgba(59, 130, 246, 0.4)",
    pulse: true,
  },
  waiting: {
    label: "Waiting",
    badgeClass: "bg-orange-500/15 text-orange-400",
    borderColor: "rgba(249, 115, 22, 0.4)",
    pulse: true,
  },
  compacting: {
    label: "Compacting",
    badgeClass: "bg-purple-500/15 text-purple-400",
    borderColor: "rgba(168, 85, 247, 0.4)",
    pulse: true,
  },
  idle: {
    label: "Your turn",
    badgeClass: "bg-emerald-500/15 text-emerald-400",
    borderColor: "rgba(16, 185, 129, 0.4)",
    pulse: false,
  },
  inactive: {
    label: "Inactive",
    badgeClass: "bg-gray-700 text-gray-400",
    borderColor: "rgba(55, 65, 81, 1)",
    pulse: false,
  },
  ended: {
    label: "Ended",
    badgeClass: "bg-gray-700 text-gray-400",
    borderColor: "rgba(55, 65, 81, 1)",
    pulse: false,
  },
};

export const STATE_PULSE_COLORS: Record<string, string> = {
  running: "bg-amber-400",
  thinking: "bg-blue-400",
  waiting: "bg-orange-400",
  compacting: "bg-purple-400",
};
