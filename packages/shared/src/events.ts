export type EventType =
  | "session.start"
  | "session.end"
  | "prompt.submit"
  | "tool.start"
  | "tool.complete"
  | "tool.fail"
  | "agent.start"
  | "agent.stop"
  | "response.complete"
  | "notification"
  | "compact.pending"
  | "task.completed"
  | "permission.request"
  | "worktree.create"
  | "worktree.remove"
  | "config.change"
  | "compact.complete"
  | "elicitation.request"
  | "elicitation.response"
  | "instructions.loaded"
  | "teammate.idle";

export interface DevscopeEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  developerId: string;
  developerName: string;
  developerEmail?: string;
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
  | ResponsePayload
  | NotificationPayload
  | PreCompactPayload
  | TaskCompletedPayload
  | PermissionRequestPayload
  | WorktreeCreatePayload
  | WorktreeRemovePayload
  | ConfigChangePayload
  | PostCompactPayload
  | ElicitationPayload
  | ElicitationResultPayload
  | InstructionsLoadedPayload
  | TeammateIdlePayload;

export interface SessionStartPayload {
  startType: string;
  permissionMode: string;
  privacyMode?: string;
  continued?: boolean;
  claudeSessionId?: string;
  model?: string;
  gitBranch?: string;
  gitCommit?: string;
  gitRemoteUrl?: string;
  claudeMdFiles?: Array<{
    path: string;
    hash: string;
    size: number;
    content?: string;
  }>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface SessionEndPayload {
  endReason: string;
  duration?: number;
  filesChanged?: string[];
  gitBranch?: string;
  gitCommit?: string;
  tokenUsage?: TokenUsage;
}

export interface PromptEventPayload {
  promptLength: number;
  isContinuation: boolean;
  promptText?: string;
}

export interface ToolEventPayload {
  toolName: string;
  toolSubcommand?: string;
  toolInput?: Record<string, unknown>;
  duration?: number;
  success?: boolean;
  errorMessage?: string;
  isInterrupt?: boolean;
  agentId?: string | null;
  /**
   * DEV-94: per-invocation correlation id from Claude Code's PreToolUse /
   * PostToolUse hooks. Pairs tool.start with tool.complete/tool.fail even
   * when the same tool runs concurrently in parallel sub-agent calls.
   * Optional — older plugin versions do not emit it; consumers MUST fall
   * back to (toolName, toolSubcommand) matching when absent.
   */
  toolUseId?: string;
}

export interface AgentEventPayload {
  agentType: string;
  agentId: string;
  parentAgentId?: string | null;
}

export interface ResponsePayload {
  responseLength?: number;
  toolsUsed?: string[];
  responseText?: string;
  tokenUsage?: TokenUsage;
}

export interface NotificationPayload {
  notificationType: string;
  title: string;
  message: string;
}

export interface PreCompactPayload {
  trigger: string;
  hasCustomInstructions?: boolean;
}

export interface TaskCompletedPayload {
  taskId: string;
  taskSubject: string;
  taskDescription: string;
  teammateName: string;
  teamName: string;
}

export interface PermissionRequestPayload {
  toolName: string;
  /**
   * DEV-96: full PermissionRequest tool_input from the Claude Code hook.
   * In `private` mode the plugin applies the same redaction as tool.start so
   * paths/patterns are hashed and Bash command / Write content / Edit args
   * are dropped before the event is sent. `permission_suggestions` is
   * intentionally omitted (low signal vs. payload size).
   */
  toolInput?: Record<string, unknown>;
}

export interface WorktreeCreatePayload {
  worktreeName: string;
}

export interface WorktreeRemovePayload {
  worktreePath: string;
}

export interface ConfigChangePayload {
  source: string;
  filePath: string;
}

export interface PostCompactPayload {
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  reductionPercent?: number;
}

export interface ElicitationPayload {
  mcpServerName: string;
  message?: string;
}

export interface ElicitationResultPayload {
  mcpServerName: string;
  duration?: number;
  responded: boolean;
  response?: string;
}

export interface InstructionsLoadedPayload {
  files: Array<{
    path: string;
    hash: string;
    size: number;
    content?: string;
    type: "claude_md" | "rule";
  }>;
  trigger: string;
}

export interface TeammateIdlePayload {
  teammateName: string;
  teamName: string;
  agentId?: string;
  idleReason?: string;
}
