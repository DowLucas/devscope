import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import { useActivityStore, type ActiveAgent } from "../../stores/activityStore";
import type { DeveloperNodeData, SessionNodeData, AgentNodeData, SessionActivityState } from "./flowTypes";
import type { DevscopeEvent, ToolEventPayload, AgentEventPayload } from "@devscope/shared";

const NODE_WIDTH_DEVELOPER = 200;
const NODE_HEIGHT_DEVELOPER = 90;
const NODE_WIDTH_SESSION = 280;
const NODE_HEIGHT_SESSION = 160;
const NODE_WIDTH_AGENT = 240;
const NODE_HEIGHT_AGENT = 110;

const TOOL_EVENT_TYPES = new Set(["tool.start", "tool.complete", "tool.fail"]);

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

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
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
    return {
      ...node,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Partition tool events between the session and its active agents.
 * Uses payload.agentId when available (future-proof), otherwise falls back
 * to temporal correlation based on agent start times.
 */
function attributeEventsToAgents(
  sessionEvents: DevscopeEvent[],
  sessionAgents: ActiveAgent[],
  allEvents: DevscopeEvent[],
): { sessionEvents: DevscopeEvent[]; agentEvents: Map<string, DevscopeEvent[]> } {
  const agentEvents = new Map<string, DevscopeEvent[]>();
  for (const agent of sessionAgents) {
    agentEvents.set(agent.agentId, []);
  }

  if (sessionAgents.length === 0) {
    return { sessionEvents, agentEvents };
  }

  // Build agent time ranges for temporal correlation
  const agentRanges = sessionAgents.map((agent) => {
    const stopEvent = allEvents.find(
      (e) =>
        e.eventType === "agent.stop" &&
        (e.payload as AgentEventPayload).agentId === agent.agentId,
    );
    return {
      agentId: agent.agentId,
      start: new Date(agent.startedAt).getTime(),
      stop: stopEvent ? new Date(stopEvent.timestamp).getTime() : Infinity,
    };
  });

  const remaining: DevscopeEvent[] = [];

  for (const event of sessionEvents) {
    // Only attribute tool events to agents
    if (!TOOL_EVENT_TYPES.has(event.eventType)) {
      remaining.push(event);
      continue;
    }

    // Path 1: Direct attribution via payload.agentId (future-proof)
    const payload = event.payload as ToolEventPayload;
    if (payload.agentId) {
      const list = agentEvents.get(payload.agentId);
      if (list) {
        list.push(event);
        continue;
      }
    }

    // Path 2: Temporal correlation
    const eventTime = new Date(event.timestamp).getTime();
    const matching = agentRanges.filter(
      (r) => eventTime >= r.start && eventTime <= r.stop,
    );

    if (matching.length === 1) {
      agentEvents.get(matching[0].agentId)!.push(event);
    } else if (matching.length > 1) {
      // Ambiguous: attribute to most recently started agent
      const latest = matching.reduce((a, b) => (a.start > b.start ? a : b));
      agentEvents.get(latest.agentId)!.push(event);
    } else {
      // No matching agent range — parent session's own tool call
      remaining.push(event);
    }
  }

  return { sessionEvents: remaining, agentEvents };
}

function deriveSessionState(
  session: { status: string },
  latestEvent: DevscopeEvent | null,
): SessionActivityState {
  if (session.status === "ended") return "ended";
  if (!latestEvent) return "idle";

  switch (latestEvent.eventType) {
    case "tool.start":
      return "running";
    case "permission.request":
      return "waiting";
    case "prompt.submit":
      return "thinking";
    case "compact.pending":
      return "compacting";
    case "tool.complete":
    case "tool.fail":
    case "agent.start":
    case "agent.stop":
      return "thinking";
    case "response.complete":
    case "session.start":
    case "notification":
    case "task.completed":
    case "config.change":
    case "worktree.create":
    case "worktree.remove":
      return "idle";
    default:
      return "idle";
  }
}

export function useFlowLayout(): { nodes: Node[]; edges: Edge[] } {
  const { developers, activeSessions, activeAgents, stoppedAgents, events } = useActivityStore(
    useShallow((s) => ({
      developers: s.developers,
      activeSessions: s.activeSessions,
      activeAgents: s.activeAgents,
      stoppedAgents: s.stoppedAgents,
      events: s.events,
    })),
  );

  // Merge active and stopped agents for layout (stopped agents remain visible during grace period)
  const allAgents = useMemo(
    () => [
      ...activeAgents.map((a) => ({ ...a, stopped: false })),
      ...stoppedAgents.map((a) => ({ ...a, stopped: true })),
    ],
    [activeAgents, stoppedAgents],
  );

  // Stage 1: Build graph structure and run dagre layout.
  // Only re-runs when the topology changes (nodes added/removed), not on every event.
  const { positionedNodes, layoutEdges } = useMemo(() => {
    const developerSessionCounts = new Map<string, number>();
    for (const session of activeSessions) {
      const devId = session.developerId;
      const count = developerSessionCounts.get(devId) ?? 0;
      developerSessionCounts.set(devId, count + 1);
    }

    const activeDevelopers = developers.filter((d) =>
      developerSessionCounts.has(d.id),
    );

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Developer nodes
    for (const dev of activeDevelopers) {
      const data: DeveloperNodeData = {
        developer: dev,
        sessionCount: developerSessionCounts.get(dev.id) ?? 0,
      };
      nodes.push({
        id: `dev-${dev.id}`,
        type: "developer",
        position: { x: 0, y: 0 },
        data,
      });
    }

    // Session + agent nodes (placeholder event data — filled in stage 2)
    for (const session of activeSessions) {
      const devId = session.developerId;
      const dev = developers.find((d) => d.id === devId);

      const data: SessionNodeData = {
        session,
        developerName: dev?.name ?? "Unknown",
        recentEvents: [],
        latestEvent: null,
        isToolRunning: false,
        currentToolName: null,
        activityState: "idle",
      };

      nodes.push({
        id: `session-${session.id}`,
        type: "session",
        position: { x: 0, y: 0 },
        data,
      });

      edges.push({
        id: `edge-${devId}-${session.id}`,
        source: `dev-${devId}`,
        target: `session-${session.id}`,
        type: "smoothstep",
        animated: session.status === "active",
        style: { stroke: "#4b5563" },
      });

      const sessionAgents = allAgents.filter(
        (a) => a.sessionId === session.id && a.agentId != null,
      );
      for (const agent of sessionAgents) {
        const isStopped = agent.stopped;
        const agentData: AgentNodeData = {
          agentId: agent.agentId,
          agentType: agent.agentType,
          sessionId: agent.sessionId,
          startedAt: agent.startedAt,
          latestEvent: null,
          isToolRunning: false,
          currentToolName: null,
          isStopped: agent.stopped,
        };

        nodes.push({
          id: `agent-${agent.agentId}`,
          type: "agent",
          position: { x: 0, y: 0 },
          data: agentData,
        });

        edges.push({
          id: `edge-${agent.sessionId}-${agent.agentId}`,
          source: `session-${session.id}`,
          target: `agent-${agent.agentId}`,
          type: "smoothstep",
          animated: !isStopped,
          style: { stroke: isStopped ? "#6b7280" : "#a855f7" },
        });
      }
    }

    if (nodes.length === 0) {
      return { positionedNodes: [] as Node[], layoutEdges: [] as Edge[] };
    }

    const laid = getLayoutedElements(nodes, edges);
    return { positionedNodes: laid.nodes, layoutEdges: laid.edges };
  }, [developers, activeSessions, allAgents]);

  // Stage 2: Decorate positioned nodes with event-derived data.
  // Runs on event changes but skips the expensive dagre layout.
  return useMemo(() => {
    if (positionedNodes.length === 0) {
      return { nodes: [], edges: layoutEdges };
    }

    const nodes = positionedNodes.map((node) => {
      if (node.type === "session") {
        const data = node.data as SessionNodeData;
        const sessionId = data.session.id;

        const allSessionEvents = events.filter(
          (e) => e.sessionId === sessionId,
        );
        const sessionAgents = allAgents.filter(
          (a) => a.sessionId === sessionId && a.agentId != null,
        );
        const { sessionEvents: ownEvents } =
          attributeEventsToAgents(allSessionEvents, sessionAgents, events);

        const recentEvents = ownEvents.slice(0, 3);
        const latestEvent = ownEvents[0] ?? null;

        let isToolRunning = false;
        let currentToolName: string | null = null;
        if (latestEvent && latestEvent.eventType === "tool.start") {
          isToolRunning = true;
          const payload = latestEvent.payload as ToolEventPayload;
          currentToolName = payload.toolName ?? null;
        }

        const activityState = deriveSessionState(data.session, latestEvent);

        return {
          ...node,
          data: {
            ...data,
            recentEvents,
            latestEvent,
            isToolRunning,
            currentToolName,
            activityState,
          },
        };
      }

      if (node.type === "agent") {
        const data = node.data as AgentNodeData;
        const agentSessionEvents = events.filter(
          (e) => e.sessionId === data.sessionId,
        );
        const sessionAgents = allAgents.filter(
          (a) => a.sessionId === data.sessionId && a.agentId != null,
        );
        const { agentEvents } =
          attributeEventsToAgents(agentSessionEvents, sessionAgents, events);

        const agentEvts = agentEvents.get(data.agentId) ?? [];
        const agentLatest = agentEvts[0] ?? null;

        let agentToolRunning = false;
        let agentToolName: string | null = null;
        if (agentLatest?.eventType === "tool.start") {
          agentToolRunning = true;
          agentToolName =
            (agentLatest.payload as ToolEventPayload).toolName ?? null;
        }

        return {
          ...node,
          data: {
            ...data,
            latestEvent: agentLatest,
            isToolRunning: agentToolRunning,
            currentToolName: agentToolName,
          },
        };
      }

      return node;
    });

    return { nodes, edges: layoutEdges };
  }, [positionedNodes, layoutEdges, events, allAgents]);
}
