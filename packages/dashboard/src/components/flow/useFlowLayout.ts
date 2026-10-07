import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { Node, Edge } from "@xyflow/react";
import { useActivityStore, type ActiveAgent } from "../../stores/activityStore";
import type {
  DeveloperNodeData,
  SessionNodeData,
  AgentNodeData,
  AgentSummaryNodeData,
  SessionActivityState,
} from "./flowTypes";
import type { FeedEvent, ToolEventPayload, AgentEventPayload } from "@devscope/shared";
import { useNow } from "@/hooks/useNow";
import { parseUTC } from "@/lib/utils";
import { getLayoutedElements } from "./layout";

/** A session whose turn has ended goes inactive after this long without events. */
const INACTIVE_AFTER_MS = 2 * 60_000;
const NOW_REFRESH_MS = 10_000;

/** States in which the session is doing work, so its edge animates. */
const WORKING_STATES = new Set<SessionActivityState>(["running", "thinking", "compacting"]);

const TOOL_EVENT_TYPES = new Set(["tool.start", "tool.complete", "tool.fail"]);

/**
 * Partition tool events between the session and its active agents.
 * Uses payload.agentId when available (future-proof), otherwise falls back
 * to temporal correlation based on agent start times.
 */
function attributeEventsToAgents(
  sessionEvents: FeedEvent[],
  sessionAgents: (ActiveAgent & { stoppedAt?: number })[],
  allEvents: FeedEvent[],
): { sessionEvents: FeedEvent[]; agentEvents: Map<string, FeedEvent[]> } {
  const agentEvents = new Map<string, FeedEvent[]>();
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
      // The stop event may have left the events window; fall back to when we saw it stop.
      stop: stopEvent ? new Date(stopEvent.timestamp).getTime() : agent.stoppedAt ?? Infinity,
    };
  });

  const remaining: FeedEvent[] = [];

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

function stateFromLatestEvent(latestEvent: FeedEvent | null): SessionActivityState {
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
    default:
      return "idle";
  }
}

function deriveSessionState(
  session: { status: string },
  latestEvent: FeedEvent | null,
  lastActivityAt: string,
  now: number,
): SessionActivityState {
  if (session.status === "ended") return "ended";
  const state = stateFromLatestEvent(latestEvent);
  const quietFor = now - parseUTC(lastActivityAt).getTime();
  return state === "idle" && quietFor > INACTIVE_AFTER_MS ? "inactive" : state;
}

/**
 * The latest of the given timestamps; `fallback` only when none is set, since
 * event times come from the client and a session's start from the server.
 */
function latestTimestamp(fallback: string, ...timestamps: (string | null | undefined)[]): string {
  let latest: string | null = null;
  for (const ts of timestamps) {
    if (ts && (!latest || parseUTC(ts).getTime() > parseUTC(latest).getTime())) latest = ts;
  }
  return latest ?? fallback;
}

/** Event times come from the developer's machine; one ahead of this browser counts as now. */
function clampToNow(timestamp: string, now: number): string {
  return parseUTC(timestamp).getTime() > now ? new Date(now).toISOString() : timestamp;
}

function summarizeAgentTypes(agents: ActiveAgent[]): AgentSummaryNodeData["types"] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    counts.set(agent.agentType, (counts.get(agent.agentType) ?? 0) + 1);
  }
  return [...counts]
    .map(([agentType, count]) => ({ agentType, count }))
    .sort((a, b) => b.count - a.count);
}

export function useFlowLayout(): { nodes: Node[]; edges: Edge[] } {
  const { developers, activeSessions, activeAgents, stoppedAgents, events, latestSessionEvents } =
    useActivityStore(
      useShallow((s) => ({
        developers: s.developers,
        activeSessions: s.activeSessions,
        activeAgents: s.activeAgents,
        stoppedAgents: s.stoppedAgents,
        events: s.events,
        latestSessionEvents: s.latestSessionEvents,
      })),
    );
  const now = useNow(NOW_REFRESH_MS);

  // Running and finished agents; finished ones are needed to attribute their past tool events.
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
    const developerIds = new Set(activeSessions.map((s) => s.developerId));
    const activeDevelopers = developers.filter((d) => developerIds.has(d.id));

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Developer nodes (session counts filled in stage 2)
    for (const dev of activeDevelopers) {
      const data: DeveloperNodeData = {
        developer: dev,
        activeCount: 0,
        inactiveCount: 0,
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
        lastActivityAt: session.startedAt,
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
        data: { sessionId: session.id },
        style: { stroke: "#4b5563" },
      });

      const sessionAgents = allAgents.filter(
        (a) => a.sessionId === session.id && a.agentId != null,
      );
      for (const agent of sessionAgents.filter((a) => !a.stopped)) {
        const agentData: AgentNodeData = {
          agentId: agent.agentId,
          agentType: agent.agentType,
          sessionId: agent.sessionId,
          startedAt: agent.startedAt,
          latestEvent: null,
          isToolRunning: false,
          currentToolName: null,
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
          animated: true,
          style: { stroke: "#a855f7" },
        });
      }

      const doneAgents = sessionAgents.filter((a) => a.stopped);
      if (doneAgents.length > 0) {
        const summaryData: AgentSummaryNodeData = {
          sessionId: session.id,
          total: doneAgents.length,
          types: summarizeAgentTypes(doneAgents),
        };

        nodes.push({
          id: `agents-done-${session.id}`,
          type: "agentSummary",
          position: { x: 0, y: 0 },
          data: summaryData,
        });

        edges.push({
          id: `edge-${session.id}-agents-done`,
          source: `session-${session.id}`,
          target: `agents-done-${session.id}`,
          type: "smoothstep",
          style: { stroke: "#4b5563" },
        });
      }
    }

    if (nodes.length === 0) {
      return { positionedNodes: [] as Node[], layoutEdges: [] as Edge[] };
    }

    const laid = getLayoutedElements(nodes, edges);
    return { positionedNodes: laid.nodes, layoutEdges: laid.edges };
  }, [developers, activeSessions, allAgents]);

  // Stage 2: Decorate positioned nodes with event- and time-derived data.
  // Runs on event changes and clock ticks but skips the expensive dagre layout.
  return useMemo(() => {
    if (positionedNodes.length === 0) {
      return { nodes: [], edges: layoutEdges };
    }

    const sessionStates = new Map<string, SessionActivityState>();

    const decorated = positionedNodes.map((node) => {
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
        const latestEvent = ownEvents[0] ?? latestSessionEvents[sessionId] ?? null;

        let isToolRunning = false;
        let currentToolName: string | null = null;
        if (latestEvent && latestEvent.eventType === "tool.start") {
          isToolRunning = true;
          const payload = latestEvent.payload as ToolEventPayload;
          currentToolName = payload.toolName ?? null;
        }

        const lastActivityAt = clampToNow(
          latestTimestamp(
            data.session.startedAt,
            data.session.lastEventAt,
            allSessionEvents[0]?.timestamp,
            latestSessionEvents[sessionId]?.timestamp,
          ),
          now,
        );
        const activityState = deriveSessionState(data.session, latestEvent, lastActivityAt, now);
        sessionStates.set(sessionId, activityState);

        return {
          ...node,
          data: {
            ...data,
            recentEvents,
            latestEvent,
            isToolRunning,
            currentToolName,
            activityState,
            lastActivityAt,
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

    const nodes = decorated.map((node) => {
      if (node.type !== "developer") return node;
      const data = node.data as DeveloperNodeData;
      let activeCount = 0;
      let inactiveCount = 0;
      for (const session of activeSessions) {
        if (session.developerId !== data.developer.id) continue;
        const state = sessionStates.get(session.id);
        if (state === "inactive") inactiveCount++;
        else if (state !== "ended") activeCount++;
      }
      return { ...node, data: { ...data, activeCount, inactiveCount } };
    });

    const edges = layoutEdges.map((edge) => {
      const sessionId = (edge.data as { sessionId?: string } | undefined)?.sessionId;
      if (!sessionId) return edge;
      const state = sessionStates.get(sessionId);
      return { ...edge, animated: state !== undefined && WORKING_STATES.has(state) };
    });

    return { nodes, edges };
  }, [positionedNodes, layoutEdges, events, latestSessionEvents, allAgents, activeSessions, now]);
}
