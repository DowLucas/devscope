import type { Node, Edge } from "@xyflow/react";
import type {
  DeveloperNodeData,
  ProjectNodeData,
  SessionNodeData,
  AgentNodeData,
  AgentSummaryNodeData,
  SessionActivityState,
} from "../flow/flowTypes";
import { getLayoutedElements } from "../flow/layout";
import { WORKING_STATES } from "../flow/useFlowLayout";
import type { Developer, Session, FeedEvent, ToolEventPayload, PromptEventPayload } from "@devscope/shared";
import type { Persona } from "./PersonaContext";

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

// --- Tool names that cycle through the simulation ---
const TOOL_NAMES = ["Edit", "Read", "Bash", "Write", "Grep", "Glob", "Agent", "WebSearch"];

const PROMPTS = [
  "Fix the failing test",
  "Add error handling",
  "Refactor this function",
  "Update the API endpoint",
  "Implement pagination",
];

// --- Non-technical friendly labels ---
const NT_PROMPTS = [
  "Working on authentication flow",
  "Fixing checkout page bug",
  "Building API endpoints",
  "Updating user dashboard",
  "Refactoring payment module",
  "Adding search feature",
  "Improving error messages",
  "Writing unit tests",
];

const NT_ACTIVITIES: Record<string, string> = {
  "tool.start": "Making changes",
  "tool.complete": "Changes saved",
  "tool.fail": "Reviewing issue",
  "prompt.submit": "Received instructions",
  "response.complete": "Finished task",
};

/** Events kept per node for the detail panel, newest first (matches the dashboard). */
const RECENT_EVENT_LIMIT = 15;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let eventCounter = 0;

function makeEvent(
  sessionId: string,
  developerId: string,
  developerName: string,
  projectName: string | null,
  eventType: FeedEvent["eventType"],
  payload: FeedEvent["payload"],
): FeedEvent {
  return {
    id: `demo-${++eventCounter}`,
    timestamp: new Date().toISOString(),
    sessionId,
    developerId,
    developerName,
    projectPath: projectName && `/app/${projectName}`,
    projectName,
    eventType,
    payload,
  };
}

// --- Mock data ---

const developers: Developer[] = [
  { id: "alice", name: "Alice Chen", email: "alice@example.com", firstSeen: minutesAgo(10080), lastSeen: minutesAgo(2) },
  { id: "bob", name: "Bob Martinez", email: "bob@example.com", firstSeen: minutesAgo(7200), lastSeen: minutesAgo(5) },
  { id: "carol", name: "Carol Singh", email: "carol@example.com", firstSeen: minutesAgo(5040), lastSeen: minutesAgo(1) },
  { id: "dave", name: "Dave Kim", email: "dave@example.com", firstSeen: minutesAgo(2880), lastSeen: minutesAgo(15) },
];

interface SessionDef {
  session: Session;
  devId: string;
  devName: string;
  /** State the card starts in, so the first frame already shows a mix. */
  initialState: SessionActivityState;
  toolCalls: number;
  toolFailures: number;
}

function session(fields: Partial<Session> & Pick<Session, "id" | "developerId" | "projectName">): Session {
  return {
    projectPath: fields.projectName ? `/app/${fields.projectName}` : null,
    startedAt: minutesAgo(30),
    endedAt: null,
    status: "active",
    permissionMode: null,
    privacyMode: "standard",
    ...fields,
  };
}

/** Alice is "you" in the demo: only your own sessions show model, tokens and cost. */
function ownUsage(model: string, input: number, output: number, cacheRead: number, cost: number): Partial<Session> {
  return {
    model,
    tokenSource: "exact",
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: cacheRead,
    estimatedCostUsd: cost,
  };
}

const sessionDefs: SessionDef[] = [
  {
    session: session({
      id: "s1", developerId: "alice", projectName: "frontend", gitBranch: "feat/oauth-login",
      currentTitle: "Add OAuth sign-in to the login form", startedAt: minutesAgo(45),
      ...ownUsage("claude-opus-5-5", 182_000, 41_000, 1_240_000, 4.82),
    }),
    devId: "alice", devName: "Alice Chen", initialState: "running", toolCalls: 64, toolFailures: 2,
  },
  {
    session: session({
      id: "s2", developerId: "alice", projectName: "api-service", gitBranch: "fix/rate-limit",
      currentTitle: "Rate limiter rejects plugin traffic", startedAt: minutesAgo(20),
      ...ownUsage("claude-sonnet-5-5", 48_000, 9_500, 310_000, 0.71),
    }),
    devId: "alice", devName: "Alice Chen", initialState: "idle", toolCalls: 23, toolFailures: 0,
  },
  {
    session: session({
      id: "s3", developerId: "bob", projectName: "backend", gitBranch: "feat/events-pagination",
      currentTitle: "Paginate the events endpoint", startedAt: minutesAgo(30),
    }),
    devId: "bob", devName: "Bob Martinez", initialState: "thinking", toolCalls: 41, toolFailures: 5,
  },
  {
    session: session({
      id: "s4", developerId: "carol", projectName: "ml-pipeline", gitBranch: "exp/embeddings",
      currentTitle: "Index prompts with pgvector", startedAt: minutesAgo(60),
    }),
    devId: "carol", devName: "Carol Singh", initialState: "running", toolCalls: 88, toolFailures: 3,
  },
  {
    session: session({
      id: "s8", developerId: "carol", projectName: "ml-pipeline", gitBranch: "feat/rerank",
      currentTitle: "Rerank search results", startedAt: minutesAgo(12),
    }),
    devId: "carol", devName: "Carol Singh", initialState: "idle", toolCalls: 9, toolFailures: 0,
  },
  {
    // Private mode: no branch, title or prompt text ever leaves the machine.
    session: session({
      id: "s5", developerId: "carol", projectName: "infra", privacyMode: "private", startedAt: minutesAgo(15),
    }),
    devId: "carol", devName: "Carol Singh", initialState: "thinking", toolCalls: 17, toolFailures: 1,
  },
  {
    session: session({
      id: "s7", developerId: "dave", projectName: "mobile-app", gitBranch: "feat/offline-mode",
      currentTitle: "Queue writes while offline", startedAt: minutesAgo(40),
    }),
    devId: "dave", devName: "Dave Kim", initialState: "inactive", toolCalls: 31, toolFailures: 4,
  },
];

const agentDefs = [
  { agentId: "agent-1", agentType: "general-purpose", description: "Refactor the auth form into hooks", model: "sonnet", sessionId: "s1", startedAt: minutesAgo(5) },
];

const doneAgentDefs: AgentSummaryNodeData[] = [
  { sessionId: "s4", total: 3, types: [{ agentType: "Explore", count: 2 }, { agentType: "Plan", count: 1 }] },
];

// --- Per-session simulation state ---

type SimPhase = "idle" | "prompt" | "tool_start" | "tool_complete" | "waiting" | "thinking";

interface SessionSimState {
  phase: SimPhase;
  toolName: string | null;
  event: FeedEvent | null;
  toolCalls: number;
  toolFailures: number;
  recentEvents: FeedEvent[];
}

function initialPhase(state: SessionActivityState): SimPhase {
  switch (state) {
    case "running": return "tool_start";
    case "thinking": return "thinking";
    default: return "idle";
  }
}

// --- Build layout (runs once) ---

export function buildDemoLayout(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const dev of developers) {
    const own = sessionDefs.filter((s) => s.devId === dev.id);
    const inactiveCount = own.filter((s) => s.initialState === "inactive").length;
    const data: DeveloperNodeData = { developer: dev, activeCount: own.length - inactiveCount, inactiveCount };
    nodes.push({ id: `dev-${dev.id}`, type: "developer", position: { x: 0, y: 0 }, data });
  }

  // A developer's sessions sharing a project hang under one project node, as in the dashboard.
  const parentOf = new Map<string, string>();
  const groups = new Map<string, SessionDef[]>();
  for (const s of sessionDefs) {
    const key = `project-${s.devId}-${s.session.projectName}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const [projectNodeId, defs] of groups) {
    if (defs.length < 2) continue;
    const data: ProjectNodeData = { projectName: defs[0].session.projectName!, sessionCount: defs.length };
    nodes.push({ id: projectNodeId, type: "project", position: { x: 0, y: 0 }, data });
    edges.push({
      id: `edge-${defs[0].devId}-${projectNodeId}`,
      source: `dev-${defs[0].devId}`,
      target: projectNodeId,
      type: "smoothstep",
      data: { sessionIds: defs.map((d) => d.session.id) },
      style: { stroke: "#4b5563" },
    });
    for (const d of defs) parentOf.set(d.session.id, projectNodeId);
  }

  for (const s of sessionDefs) {
    const inactive = s.initialState === "inactive";
    const data: SessionNodeData = {
      session: s.session,
      recentEvents: [],
      latestEvent: null,
      isToolRunning: false,
      currentToolName: null,
      activityState: s.initialState,
      lastActivityAt: minutesAgo(inactive ? 6 : 0),
      toolCalls: s.toolCalls,
      toolFailures: s.toolFailures,
    };
    nodes.push({ id: `session-${s.session.id}`, type: "session", position: { x: 0, y: 0 }, data });
    const source = parentOf.get(s.session.id) ?? `dev-${s.devId}`;
    edges.push({
      id: `edge-${source}-${s.session.id}`,
      source,
      target: `session-${s.session.id}`,
      type: "smoothstep",
      data: { sessionIds: [s.session.id] },
      style: { stroke: "#4b5563" },
    });
  }

  for (const a of agentDefs) {
    const data: AgentNodeData = {
      agentId: a.agentId,
      agentType: a.agentType,
      description: a.description,
      model: a.model,
      sessionId: a.sessionId,
      startedAt: a.startedAt,
      latestEvent: null,
      isToolRunning: false,
      currentToolName: null,
      recentEvents: [],
    };
    nodes.push({ id: `agent-${a.agentId}`, type: "agent", position: { x: 0, y: 0 }, data });
    edges.push({
      id: `edge-${a.sessionId}-${a.agentId}`,
      source: `session-${a.sessionId}`,
      target: `agent-${a.agentId}`,
      type: "smoothstep",
      animated: true,
      style: { stroke: "#a855f7" },
    });
  }

  for (const data of doneAgentDefs) {
    nodes.push({ id: `agents-done-${data.sessionId}`, type: "agentSummary", position: { x: 0, y: 0 }, data });
    edges.push({
      id: `edge-${data.sessionId}-agents-done`,
      source: `session-${data.sessionId}`,
      target: `agents-done-${data.sessionId}`,
      type: "smoothstep",
      style: { stroke: "#4b5563" },
    });
  }

  return getLayoutedElements(nodes, edges);
}

// --- Event simulation ---

const sessionSimStates = new Map<string, SessionSimState>();
for (const s of sessionDefs) {
  sessionSimStates.set(s.session.id, {
    phase: initialPhase(s.initialState),
    toolName: s.initialState === "running" ? "Edit" : null,
    event: null,
    toolCalls: s.toolCalls,
    toolFailures: s.toolFailures,
    recentEvents: [],
  });
}

// Agent simulation state (only for active agent)
const agentSimState: SessionSimState = { phase: "idle", toolName: null, event: null, toolCalls: 0, toolFailures: 0, recentEvents: [] };

/** Sessions the simulation advances; the inactive one stays put so its state is visible. */
const liveDefs = sessionDefs.filter((s) => s.initialState !== "inactive");

function nextPhase(current: SimPhase): SimPhase {
  switch (current) {
    case "idle": return "prompt";
    case "prompt": return "tool_start";
    case "tool_start": return Math.random() > 0.85 ? "waiting" : "tool_complete";
    case "waiting": return "tool_complete";
    case "tool_complete": return Math.random() > 0.4 ? "tool_start" : "thinking";
    case "thinking": return "idle";
  }
}

function phaseToActivityState(phase: SimPhase): SessionActivityState {
  switch (phase) {
    case "idle": return "idle";
    case "prompt": return "thinking";
    case "tool_start": return "running";
    case "waiting": return "waiting";
    case "tool_complete": return "thinking";
    case "thinking": return "thinking";
  }
}

function remember(state: SessionSimState, event: FeedEvent | null) {
  state.event = event;
  if (event) state.recentEvents = [event, ...state.recentEvents].slice(0, RECENT_EVENT_LIMIT);
}

/**
 * Advance simulation by one tick. Call from setInterval.
 * Returns updated nodes (positions unchanged, data updated).
 * When persona is "non-technical", uses business-friendly labels
 * instead of raw tool names.
 */
export function tickSimulation(baseNodes: Node[], persona?: Persona | null): Node[] {
  const isNT = persona === "non-technical";
  // Pick 1-3 random sessions to advance
  const count = 1 + Math.floor(Math.random() * 3);
  const toAdvance = new Set<string>();
  for (let i = 0; i < count; i++) {
    toAdvance.add(pick(liveDefs).session.id);
  }

  // Maybe advance the active agent too
  const advanceAgent = Math.random() > 0.5;

  // Advance selected sessions
  for (const sid of toAdvance) {
    const state = sessionSimStates.get(sid)!;
    state.phase = nextPhase(state.phase);

    const sDef = sessionDefs.find((s) => s.session.id === sid)!;
    const isPrivate = sDef.session.privacyMode === "private";
    const event = (type: FeedEvent["eventType"], payload: FeedEvent["payload"]) =>
      makeEvent(sid, sDef.devId, sDef.devName, sDef.session.projectName, type, payload);

    switch (state.phase) {
      case "prompt": {
        state.toolName = null;
        // Private sessions never send prompt text, so the card shows only its length.
        const promptText = isPrivate ? undefined : isNT ? pick(NT_PROMPTS) : pick(PROMPTS);
        remember(state, event("prompt.submit", {
          promptLength: 20 + Math.floor(Math.random() * 200),
          isContinuation: false,
          promptText,
        } satisfies PromptEventPayload));
        break;
      }
      case "tool_start": {
        const toolName = isNT ? NT_ACTIVITIES["tool.start"] : pick(TOOL_NAMES);
        state.toolName = toolName;
        remember(state, event("tool.start", { toolName } satisfies ToolEventPayload));
        break;
      }
      case "waiting": {
        remember(state, event("permission.request", { toolName: state.toolName ?? "Bash" } satisfies ToolEventPayload));
        break;
      }
      case "tool_complete": {
        const success = Math.random() > 0.1;
        const completedLabel = isNT
          ? (success ? NT_ACTIVITIES["tool.complete"] : NT_ACTIVITIES["tool.fail"])
          : (state.toolName ?? "Edit");
        state.toolCalls += 1;
        if (!success) state.toolFailures += 1;
        remember(state, event(success ? "tool.complete" : "tool.fail", {
          toolName: completedLabel,
          success,
          duration: 100 + Math.floor(Math.random() * 2000),
        } satisfies ToolEventPayload));
        state.toolName = null;
        break;
      }
      case "thinking": {
        state.toolName = null;
        remember(state, event("response.complete", {
          responseLength: 50 + Math.floor(Math.random() * 500),
          toolsUsed: [],
        }));
        break;
      }
      case "idle": {
        state.toolName = null;
        state.event = null;
        break;
      }
    }
  }

  // Advance active agent
  if (advanceAgent) {
    const activeAgent = agentDefs[0]; // agent-1 is active
    agentSimState.phase = nextPhase(agentSimState.phase);
    if (agentSimState.phase === "waiting") agentSimState.phase = "tool_complete";
    const sDef = sessionDefs.find((s) => s.session.id === activeAgent.sessionId)!;

    switch (agentSimState.phase) {
      case "tool_start": {
        const toolName = isNT ? NT_ACTIVITIES["tool.start"] : pick(TOOL_NAMES);
        agentSimState.toolName = toolName;
        remember(agentSimState, makeEvent(activeAgent.sessionId, sDef.devId, sDef.devName, sDef.session.projectName, "tool.start", {
          toolName,
          agentId: activeAgent.agentId,
        } satisfies ToolEventPayload));
        break;
      }
      case "tool_complete": {
        const completedLabel = isNT ? NT_ACTIVITIES["tool.complete"] : (agentSimState.toolName ?? "Read");
        remember(agentSimState, makeEvent(activeAgent.sessionId, sDef.devId, sDef.devName, sDef.session.projectName, "tool.complete", {
          toolName: completedLabel,
          success: true,
          duration: 200 + Math.floor(Math.random() * 1500),
          agentId: activeAgent.agentId,
        } satisfies ToolEventPayload));
        agentSimState.toolName = null;
        break;
      }
      default: {
        agentSimState.event = null;
        agentSimState.toolName = null;
        break;
      }
    }
  }

  // Update node data
  return baseNodes.map((node) => {
    if (node.type === "session") {
      const data = node.data as SessionNodeData;
      const sid = data.session.id;
      const state = sessionSimStates.get(sid);
      if (!state || data.activityState === "inactive") return node;

      // Your own sessions accrue tokens and cost as replies come in.
      let session = data.session;
      if (session.tokenSource && toAdvance.has(sid) && state.phase === "thinking") {
        const output = 400 + Math.floor(Math.random() * 1600);
        session = {
          ...session,
          totalInputTokens: (session.totalInputTokens ?? 0) + output * 3,
          totalOutputTokens: (session.totalOutputTokens ?? 0) + output,
          totalCacheReadTokens: (session.totalCacheReadTokens ?? 0) + output * 20,
          estimatedCostUsd: (session.estimatedCostUsd ?? 0) + output * 0.00004,
        };
      }

      return {
        ...node,
        data: {
          ...data,
          session,
          latestEvent: state.event,
          recentEvents: state.recentEvents,
          isToolRunning: state.phase === "tool_start",
          currentToolName: state.toolName,
          activityState: phaseToActivityState(state.phase),
          toolCalls: state.toolCalls,
          toolFailures: state.toolFailures,
          lastActivityAt: toAdvance.has(sid) ? new Date().toISOString() : data.lastActivityAt,
        },
      };
    }

    if (node.type === "agent") {
      const data = node.data as AgentNodeData;

      return {
        ...node,
        data: {
          ...data,
          latestEvent: agentSimState.event,
          recentEvents: agentSimState.recentEvents,
          isToolRunning: agentSimState.phase === "tool_start",
          currentToolName: agentSimState.toolName,
        },
      };
    }

    return node;
  });
}

export interface DemoFilters {
  hideInactive: boolean;
  hideDoneAgents: boolean;
}

/**
 * Applies the toolbar filters and animates an edge only while a session below it
 * is working, the same rule the dashboard uses. Layout positions are untouched.
 */
export function applyDemoView(
  nodes: Node[],
  edges: Edge[],
  filters: DemoFilters,
): { nodes: Node[]; edges: Edge[] } {
  const states = new Map<string, SessionActivityState>();
  for (const n of nodes) {
    if (n.type === "session") {
      const d = n.data as SessionNodeData;
      states.set(d.session.id, d.activityState);
    }
  }

  const hidden = new Set<string>();
  for (const n of nodes) {
    if (filters.hideInactive && n.type === "session" && (n.data as SessionNodeData).activityState === "inactive") {
      hidden.add(n.id);
    }
    if (filters.hideDoneAgents && n.type === "agentSummary") hidden.add(n.id);
  }
  // A developer with nothing left visible goes too.
  if (filters.hideInactive) {
    for (const n of nodes) {
      if (n.type !== "developer") continue;
      const children = edges.filter((e) => e.source === n.id).map((e) => e.target);
      if (children.length > 0 && children.every((c) => hidden.has(c))) hidden.add(n.id);
    }
  }

  return {
    nodes: nodes.map((n) => (hidden.has(n.id) ? { ...n, hidden: true } : n.hidden ? { ...n, hidden: false } : n)),
    edges: edges.map((e) => {
      const sessionIds = (e.data as { sessionIds?: string[] } | undefined)?.sessionIds;
      const animated = sessionIds
        ? sessionIds.some((id) => WORKING_STATES.has(states.get(id) ?? "idle"))
        : e.animated;
      return { ...e, animated, hidden: hidden.has(e.source) || hidden.has(e.target) };
    }),
  };
}
