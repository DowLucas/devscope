import type { Developer, Session } from "@devscope/shared";
import type { FeedEvent } from "@devscope/shared";

export type SessionActivityState =
  | "running"
  | "thinking"
  | "waiting"
  | "compacting"
  | "idle"
  | "ended";

export interface DeveloperNodeData {
  [key: string]: unknown;
  developer: Developer;
  sessionCount: number;
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
  isStopped: boolean;
}
