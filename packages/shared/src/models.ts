export type PrivacyMode = "private" | "open" | "standard" | null;

export interface Developer {
  id: string;
  name: string;
  email: string;
  firstSeen: string;
  lastSeen: string;
}

/**
 * What the viewer may see of a session: their own (self), a teammate's who
 * opted in to sharing (shared), or only that it happened (activity — project,
 * title, content and tokens are null/empty).
 */
export type SessionVisibility = "self" | "shared" | "activity";

export interface Session {
  id: string;
  developerId: string;
  projectPath: string | null;
  projectName: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "ended";
  permissionMode: string | null;
  privacyMode: PrivacyMode;
  currentTitle?: string | null;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheCreationTokens?: number;
  totalCacheReadTokens?: number;
  estimatedCostUsd?: number;
  visibility?: SessionVisibility;
}

export type WsMessageType =
  | "event.new"
  | "session.update"
  | "session.title.update"
  | "developer.update"
  | "alert.triggered"
  | "ai.insight.new"
  | "ai.report.completed"
  | "ai.pattern.new"
  | "ai.antipattern.new"
  | "ai.playbook.new"
  | "ai.skill.new"
  | "ai.skill.updated"
  | "ethics.audit.new"
  | "friction.alert"
  | "subscribe"
  | "connected";

export interface SessionDetail {
  session: {
    id: string;
    developerId: string;
    developerName: string;
    developerEmail: string;
    projectPath: string | null;
    projectName: string | null;
    currentTitle?: string | null;
    startedAt: string;
    endedAt: string | null;
    status: string;
    permissionMode: string | null;
    privacyMode: PrivacyMode;
    eventCount: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCacheCreationTokens?: number;
    totalCacheReadTokens?: number;
    estimatedCostUsd?: number;
  };
  events: Array<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  visibility: SessionVisibility;
  isSelfView: boolean;
}

export interface ToolCallEntry {
  toolName: string;
  toolSubcommand?: string;
  toolInput?: Record<string, unknown>;
  success?: boolean;
  isInterrupt?: boolean;
  duration?: number;
  errorMessage?: string;
  timestamp: string;
}

export interface SessionTurn {
  prompt?: {
    content: string;
    timestamp: string;
  };
  toolCalls: ToolCallEntry[];
  agents: Array<{
    agentType: string;
    agentId: string;
    action: "start" | "stop";
    timestamp: string;
  }>;
  response?: {
    toolsUsed: string[];
    responseLength?: number;
    responseText?: string;
    timestamp: string;
  };
}

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}

export interface SessionTitle {
  id: string;
  sessionId: string;
  title: string;
  generatedAt: string;
}
