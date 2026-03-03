export interface Developer {
  id: string;
  name: string;
  email: string;
  firstSeen: string;
  lastSeen: string;
}

export interface Session {
  id: string;
  developerId: string;
  projectPath: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "ended";
  permissionMode: string | null;
}

export type WsMessageType =
  | "event.new"
  | "session.update"
  | "developer.update"
  | "alert.triggered"
  | "ai.insight.new"
  | "ai.report.completed"
  | "ai.pattern.new"
  | "ai.antipattern.new"
  | "ai.playbook.new"
  | "subscribe"
  | "connected";

export interface SessionDetail {
  session: {
    id: string;
    developerId: string;
    developerName: string;
    developerEmail: string;
    projectPath: string;
    projectName: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
    permissionMode: string | null;
    eventCount: number;
  };
  events: Array<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface ToolCallEntry {
  toolName: string;
  toolInput?: Record<string, unknown>;
  success?: boolean;
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
    timestamp: string;
  };
}

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}
