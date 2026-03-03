import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { DeveloperNodeData, SessionNodeData, AgentNodeData, SessionActivityState } from "../flow/flowTypes";
import type { Developer, Session, DevscopeEvent, ToolEventPayload, PromptEventPayload } from "@devscope/shared";
import type { Persona } from "./PersonaContext";

const NODE_WIDTH_DEVELOPER = 200;
const NODE_HEIGHT_DEVELOPER = 90;
const NODE_WIDTH_SESSION = 280;
const NODE_HEIGHT_SESSION = 160;
const NODE_WIDTH_AGENT = 240;
const NODE_HEIGHT_AGENT = 110;

function getNodeDimensions(type: string): { width: number; height: number } {
  switch (type) {
    case "developer":
      return { width: NODE_WIDTH_DEVELOPER, height: NODE_HEIGHT_DEVELOPER };
    case "agent":
      return { width: NODE_WIDTH_AGENT, height: NODE_HEIGHT_AGENT };
    default:
      return { width: NODE_WIDTH_SESSION, height: NODE_HEIGHT_SESSION };
  }
}

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

// --- Tool names that cycle through the simulation ---
const TOOL_NAMES = ["Edit", "Read", "Bash", "Write", "Grep", "Glob", "Agent", "WebSearch"];

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

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let eventCounter = 0;

function makeEvent(
  sessionId: string,
  developerId: string,
  developerName: string,
  projectName: string,
  eventType: DevscopeEvent["eventType"],
  payload: DevscopeEvent["payload"],
): DevscopeEvent {
  return {
    id: `demo-${++eventCounter}`,
    timestamp: new Date().toISOString(),
    sessionId,
    developerId,
    developerName,
    projectPath: `/app/${projectName}`,
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
}

const sessionDefs: SessionDef[] = [
  { session: { id: "s1", developerId: "alice", projectPath: "/app/frontend", projectName: "frontend", startedAt: minutesAgo(45), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "alice", devName: "Alice Chen" },
  { session: { id: "s2", developerId: "alice", projectPath: "/app/api", projectName: "api-service", startedAt: minutesAgo(20), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "alice", devName: "Alice Chen" },
  { session: { id: "s3", developerId: "bob", projectPath: "/app/backend", projectName: "backend", startedAt: minutesAgo(30), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "bob", devName: "Bob Martinez" },
  { session: { id: "s4", developerId: "carol", projectPath: "/app/ml", projectName: "ml-pipeline", startedAt: minutesAgo(60), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "carol", devName: "Carol Singh" },
  { session: { id: "s5", developerId: "carol", projectPath: "/app/infra", projectName: "infra", startedAt: minutesAgo(15), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "carol", devName: "Carol Singh" },
  { session: { id: "s6", developerId: "carol", projectPath: "/app/docs", projectName: "docs", startedAt: minutesAgo(8), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "carol", devName: "Carol Singh" },
  { session: { id: "s7", developerId: "dave", projectPath: "/app/mobile", projectName: "mobile-app", startedAt: minutesAgo(25), endedAt: null, status: "active", permissionMode: null, privacyMode: null }, devId: "dave", devName: "Dave Kim" },
];

const agentDefs = [
  { agentId: "agent-1", agentType: "general-purpose", sessionId: "s1", startedAt: minutesAgo(5), isStopped: false },
  { agentId: "agent-2", agentType: "Explore", sessionId: "s4", startedAt: minutesAgo(10), isStopped: true },
];

// --- Per-session simulation state ---

type SimPhase = "idle" | "prompt" | "tool_start" | "tool_complete" | "thinking";

interface SessionSimState {
  phase: SimPhase;
  toolName: string | null;
  event: DevscopeEvent | null;
}

// --- Build layout (runs once) ---

export function buildDemoLayout(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const devSessionCounts = new Map<string, number>();
  for (const s of sessionDefs) {
    devSessionCounts.set(s.devId, (devSessionCounts.get(s.devId) ?? 0) + 1);
  }

  for (const dev of developers) {
    const data: DeveloperNodeData = {
      developer: dev,
      sessionCount: devSessionCounts.get(dev.id) ?? 0,
    };
    nodes.push({ id: `dev-${dev.id}`, type: "developer", position: { x: 0, y: 0 }, data });
  }

  for (const s of sessionDefs) {
    const data: SessionNodeData = {
      session: s.session,
      developerName: s.devName,
      recentEvents: [],
      latestEvent: null,
      isToolRunning: false,
      currentToolName: null,
      activityState: "idle",
    };
    nodes.push({ id: `session-${s.session.id}`, type: "session", position: { x: 0, y: 0 }, data });
    edges.push({
      id: `edge-${s.devId}-${s.session.id}`,
      source: `dev-${s.devId}`,
      target: `session-${s.session.id}`,
      type: "smoothstep",
      animated: true,
      style: { stroke: "#4b5563" },
    });
  }

  for (const a of agentDefs) {
    const data: AgentNodeData = {
      agentId: a.agentId,
      agentType: a.agentType,
      sessionId: a.sessionId,
      startedAt: a.startedAt,
      latestEvent: null,
      isToolRunning: false,
      currentToolName: null,
      isStopped: a.isStopped,
    };
    nodes.push({ id: `agent-${a.agentId}`, type: "agent", position: { x: 0, y: 0 }, data });
    edges.push({
      id: `edge-${a.sessionId}-${a.agentId}`,
      source: `session-${a.sessionId}`,
      target: `agent-${a.agentId}`,
      type: "smoothstep",
      animated: !a.isStopped,
      style: { stroke: a.isStopped ? "#6b7280" : "#a855f7" },
    });
  }

  // Run Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 80 });

  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node.type ?? "session");
    g.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const { width, height } = getNodeDimensions(node.type ?? "session");
    return { ...node, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });

  return { nodes: layoutedNodes, edges };
}

// --- Event simulation ---

const sessionSimStates = new Map<string, SessionSimState>();
for (const s of sessionDefs) {
  sessionSimStates.set(s.session.id, { phase: "idle", toolName: null, event: null });
}

// Agent simulation state (only for active agent)
let agentSimState: SessionSimState = { phase: "idle", toolName: null, event: null };

function nextPhase(current: SimPhase): SimPhase {
  switch (current) {
    case "idle": return "prompt";
    case "prompt": return "tool_start";
    case "tool_start": return "tool_complete";
    case "tool_complete": return Math.random() > 0.4 ? "tool_start" : "thinking";
    case "thinking": return "idle";
  }
}

function phaseToActivityState(phase: SimPhase): SessionActivityState {
  switch (phase) {
    case "idle": return "idle";
    case "prompt": return "thinking";
    case "tool_start": return "running";
    case "tool_complete": return "thinking";
    case "thinking": return "thinking";
  }
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
    toAdvance.add(pick(sessionDefs).session.id);
  }

  // Maybe advance the active agent too
  const advanceAgent = Math.random() > 0.5;

  // Advance selected sessions
  for (const sid of toAdvance) {
    const state = sessionSimStates.get(sid)!;
    state.phase = nextPhase(state.phase);

    const sDef = sessionDefs.find((s) => s.session.id === sid)!;

    switch (state.phase) {
      case "prompt": {
        state.toolName = null;
        const promptText = isNT
          ? pick(NT_PROMPTS)
          : pick(["Fix the failing test", "Add error handling", "Refactor this function", "Update the API endpoint", "Implement pagination"]);
        state.event = makeEvent(sid, sDef.devId, sDef.devName, sDef.session.projectName, "prompt.submit", {
          promptLength: 20 + Math.floor(Math.random() * 200),
          isContinuation: false,
          promptText,
        } satisfies PromptEventPayload);
        break;
      }
      case "tool_start": {
        const rawToolName = pick(TOOL_NAMES);
        const toolName = isNT ? (NT_ACTIVITIES["tool.start"]) : rawToolName;
        state.toolName = toolName;
        state.event = makeEvent(sid, sDef.devId, sDef.devName, sDef.session.projectName, "tool.start", {
          toolName,
        } satisfies ToolEventPayload);
        break;
      }
      case "tool_complete": {
        const success = Math.random() > 0.1;
        const completedLabel = isNT
          ? (success ? NT_ACTIVITIES["tool.complete"] : NT_ACTIVITIES["tool.fail"])
          : (state.toolName ?? "Edit");
        state.event = makeEvent(sid, sDef.devId, sDef.devName, sDef.session.projectName, success ? "tool.complete" : "tool.fail", {
          toolName: completedLabel,
          success,
          duration: 100 + Math.floor(Math.random() * 2000),
        } satisfies ToolEventPayload);
        state.toolName = null;
        break;
      }
      case "thinking": {
        state.toolName = null;
        state.event = makeEvent(sid, sDef.devId, sDef.devName, sDef.session.projectName, "response.complete", {
          responseLength: 50 + Math.floor(Math.random() * 500),
          toolsUsed: [],
        });
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
    const sDef = sessionDefs.find((s) => s.session.id === activeAgent.sessionId)!;

    switch (agentSimState.phase) {
      case "tool_start": {
        const rawToolName = pick(TOOL_NAMES);
        const toolName = isNT ? NT_ACTIVITIES["tool.start"] : rawToolName;
        agentSimState.toolName = toolName;
        agentSimState.event = makeEvent(activeAgent.sessionId, sDef.devId, sDef.devName, sDef.session.projectName, "tool.start", {
          toolName,
          agentId: activeAgent.agentId,
        } satisfies ToolEventPayload);
        break;
      }
      case "tool_complete": {
        const completedLabel = isNT ? NT_ACTIVITIES["tool.complete"] : (agentSimState.toolName ?? "Read");
        agentSimState.event = makeEvent(activeAgent.sessionId, sDef.devId, sDef.devName, sDef.session.projectName, "tool.complete", {
          toolName: completedLabel,
          success: true,
          duration: 200 + Math.floor(Math.random() * 1500),
          agentId: activeAgent.agentId,
        } satisfies ToolEventPayload);
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
      if (!state) return node;

      return {
        ...node,
        data: {
          ...data,
          latestEvent: state.event,
          isToolRunning: state.phase === "tool_start",
          currentToolName: state.toolName,
          activityState: phaseToActivityState(state.phase),
        },
      };
    }

    if (node.type === "agent") {
      const data = node.data as AgentNodeData;
      if (data.isStopped) return node; // Don't simulate stopped agents

      return {
        ...node,
        data: {
          ...data,
          latestEvent: agentSimState.event,
          isToolRunning: agentSimState.phase === "tool_start",
          currentToolName: agentSimState.toolName,
        },
      };
    }

    return node;
  });
}
