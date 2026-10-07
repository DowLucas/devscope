import type { Developer, Session } from "@devscope/shared";
import type { FeedEvent } from "@devscope/shared";

export type SessionActivityState =
  | "running"
  | "thinking"
  | "waiting"
  | "compacting"
  | "idle"
  | "inactive"
  | "ended";

export interface DeveloperNodeData {
  [key: string]: unknown;
  developer: Developer;
  /** Sessions neither inactive nor ended. */
  activeCount: number;
  inactiveCount: number;
}

export interface SessionNodeData {
  [key: string]: unknown;
  session: Session;
  developerName: string;
  recentEvents: FeedEvent[];
  latestEvent: FeedEvent | null;
  isToolRunning: boolean;
  currentToolName: string | null;
  activityState: SessionActivityState;
  /** Latest event of the session or its subagents, else its start. */
  lastActivityAt: string;
}

export interface AgentNodeData {
  [key: string]: unknown;
  agentId: string;
  agentType: string;
  sessionId: string;
  startedAt: string;
  latestEvent: FeedEvent | null;
  isToolRunning: boolean;
  currentToolName: string | null;
}

/** All finished subagents of one session, collapsed into a single node. */
export interface AgentSummaryNodeData {
  [key: string]: unknown;
  sessionId: string;
  total: number;
  /** Count per agent type, most frequent first. */
  types: { agentType: string; count: number }[];
}
