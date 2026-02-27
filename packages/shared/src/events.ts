export type EventType =
  | "session.start"
  | "session.end"
  | "prompt.submit"
  | "tool.start"
  | "tool.complete"
  | "tool.fail"
  | "agent.start"
  | "agent.stop"
  | "response.complete";

export interface GroundcontrolEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  developerId: string;
  developerName: string;
  developerEmail: string;
  projectPath: string;
  projectName: string;
  eventType: EventType;
  payload: EventPayload;
}

export type EventPayload =
  | SessionStartPayload
  | SessionEndPayload
  | PromptEventPayload
  | ToolEventPayload
  | AgentEventPayload
  | ResponsePayload;

export interface SessionStartPayload {
  startType: string;
  permissionMode: string;
}

export interface SessionEndPayload {
  endReason: string;
  duration?: number;
}

export interface PromptEventPayload {
  promptContent: string;
  promptLength: number;
  isContinuation: boolean;
}

export interface ToolEventPayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
  duration?: number;
  success?: boolean;
}

export interface AgentEventPayload {
  agentType: string;
  agentId: string;
}

export interface ResponsePayload {
  responseLength?: number;
  toolsUsed: string[];
}
