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
  | "subscribe"
  | "connected";

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}
