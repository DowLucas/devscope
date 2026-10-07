import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { Node, Edge } from "@xyflow/react";
import { useActivityStore, type ActiveAgent } from "../../stores/activityStore";
import type {
  DeveloperNodeData,
  SessionNodeData,
  AgentNodeData,
  AgentSummaryNodeData,
  ProjectNodeData,
  SessionActivityState,
} from "./flowTypes";
import type { FeedEvent, Session, ToolEventPayload, AgentEventPayload } from "@devscope/shared";
import { useNow } from "@/hooks/useNow";
import { parseUTC } from "@/lib/utils";
import { getLayoutedElements } from "./layout";

/** A session whose turn has ended goes inactive after this long without events. */
const INACTIVE_AFTER_MS = 2 * 60_000;
const NOW_REFRESH_MS = 10_000;

/** States in which the session is doing work, so its edge animates. */
const WORKING_STATES = new Set<SessionActivityState>(["running", "thinking", "compacting"]);

/** Events kept per node for the detail panel. */
const RECENT_EVENT_LIMIT = 15;

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

export interface FlowFilters {
  hideInactive: boolean;
  hideDoneAgents: boolean;
}

interface SessionActivity {
  ownEvents: FeedEvent[];
  latestEvent: FeedEvent | null;
  lastActivityAt: string;
  state: SessionActivityState;
}

/** Edges carry the sessions below them, so an edge animates while any of them works. */
interface FlowEdgeData {
  [key: string]: unknown;
  sessionIds: string[];
}

export function useFlowLayout(filters: FlowFilters): { nodes: Node[]; edges: Edge[] } {
  const { developers, activeSessions, activeAgents, stoppedAgents, events, latestSessionEvents, toolCounts } =
    useActivityStore(
      useShallow((s) => ({
        developers: s.developers,
        activeSessions: s.activeSessions,
        activeAgents: s.activeAgents,
        stoppedAgents: s.stoppedAgents,
        events: s.events,
        latestSessionEvents: s.latestSessionEvents,
        toolCounts: s.toolCounts,
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

  // Stage 0: each session's own events and state. Feeds both the filters and stage 2.
  const sessionActivity = useMemo(() => {
    const activity = new Map<string, SessionActivity>();
    for (const session of activeSessions) {
      const allSessionEvents = events.filter((e) => e.sessionId === session.id);
      const sessionAgents = allAgents.filter(
        (a) => a.sessionId === session.id && a.agentId != null,
      );
      const { sessionEvents: ownEvents } =
        attributeEventsToAgents(allSessionEvents, sessionAgents, events);
      const latestEvent = ownEvents[0] ?? latestSessionEvents[session.id] ?? null;
      const lastActivityAt = clampToNow(
        latestTimestamp(
          session.startedAt,
          session.lastEventAt,
          allSessionEvents[0]?.timestamp,
          latestSessionEvents[session.id]?.timestamp,
        ),
        now,
      );
      activity.set(session.id, {
        ownEvents,
        latestEvent,
        lastActivityAt,
        state: deriveSessionState(session, latestEvent, lastActivityAt, now),
      });
    }
    return activity;
  }, [activeSessions, events, latestSessionEvents, allAgents, now]);

  // A string, so the layout re-runs only when the set of hidden sessions changes.
  const hiddenSessionKey = filters.hideInactive
    ? activeSessions
        .filter((s) => sessionActivity.get(s.id)?.state === "inactive")
        .map((s) => s.id)
        .sort()
        .join(",")
    : "";
  const { hideDoneAgents } = filters;

  // Stage 1: Build graph structure and run dagre layout.
  // Only re-runs when the topology changes (nodes added/removed), not on every event.
  const { positionedNodes, layoutEdges } = useMemo(() => {
    const hidden = new Set(hiddenSessionKey ? hiddenSessionKey.split(",") : []);
    const visibleSessions = activeSessions.filter((s) => !hidden.has(s.id));
    // Developers stay visible with their counts even when every session is hidden.
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

    // A developer's sessions sharing a project hang under one project node.
    const projectGroups = new Map<string, Session[]>();
    for (const session of visibleSessions) {
      if (!session.projectName) continue;
      const key = `project-${session.developerId}-${session.projectName}`;
      projectGroups.set(key, [...(projectGroups.get(key) ?? []), session]);
    }
    const parentNodeId = new Map<string, string>();
    for (const [projectNodeId, sessions] of projectGroups) {
      if (sessions.length < 2) continue;
      const devId = sessions[0].developerId;
      const data: ProjectNodeData = {
        projectName: sessions[0].projectName!,
        sessionCount: sessions.length,
      };
      nodes.push({ id: projectNodeId, type: "project", position: { x: 0, y: 0 }, data });
      const edgeData: FlowEdgeData = { sessionIds: sessions.map((s) => s.id) };
      edges.push({
        id: `edge-${devId}-${projectNodeId}`,
        source: `dev-${devId}`,
        target: projectNodeId,
        type: "smoothstep",
        data: edgeData,
        style: { stroke: "#4b5563" },
      });
      for (const session of sessions) parentNodeId.set(session.id, projectNodeId);
    }

    // Session + agent nodes (placeholder event data — filled in stage 2)
    for (const session of visibleSessions) {
      const data: SessionNodeData = {
        session,
        recentEvents: [],
        latestEvent: null,
        isToolRunning: false,
        currentToolName: null,
        activityState: "idle",
        lastActivityAt: session.startedAt,
        toolCalls: null,
        toolFailures: null,
      };

      nodes.push({
        id: `session-${session.id}`,
        type: "session",
        position: { x: 0, y: 0 },
        data,
      });

      const source = parentNodeId.get(session.id) ?? `dev-${session.developerId}`;
      const edgeData: FlowEdgeData = { sessionIds: [session.id] };
      edges.push({
        id: `edge-${source}-${session.id}`,
        source,
        target: `session-${session.id}`,
        type: "smoothstep",
        data: edgeData,
        style: { stroke: "#4b5563" },
      });

      const sessionAgents = allAgents.filter(
        (a) => a.sessionId === session.id && a.agentId != null,
      );
      for (const agent of sessionAgents.filter((a) => !a.stopped)) {
        const agentData: AgentNodeData = {
          agentId: agent.agentId,
          agentType: agent.agentType,
          description: agent.description ?? null,
          model: agent.model ?? null,
          sessionId: agent.sessionId,
          startedAt: agent.startedAt,
          latestEvent: null,
          isToolRunning: false,
          currentToolName: null,
          recentEvents: [],
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
      if (doneAgents.length > 0 && !hideDoneAgents) {
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
  }, [developers, activeSessions, allAgents, hiddenSessionKey, hideDoneAgents]);

  // Stage 2: Decorate positioned nodes with event- and time-derived data.
  // Runs on event changes and clock ticks but skips the expensive dagre layout.
  return useMemo(() => {
    if (positionedNodes.length === 0) {
      return { nodes: [], edges: layoutEdges };
    }

    const nodes = positionedNodes.map((node) => {
      if (node.type === "session") {
        const data = node.data as SessionNodeData;
        const sessionId = data.session.id;
        const activity = sessionActivity.get(sessionId);
        if (!activity) return node;
        const { latestEvent } = activity;

        let isToolRunning = false;
        let currentToolName: string | null = null;
        if (latestEvent && latestEvent.eventType === "tool.start") {
          isToolRunning = true;
          const payload = latestEvent.payload as ToolEventPayload;
          currentToolName = payload.toolName ?? null;
        }

        return {
          ...node,
          data: {
            ...data,
            recentEvents: activity.ownEvents.slice(0, RECENT_EVENT_LIMIT),
            latestEvent,
            isToolRunning,
            currentToolName,
            activityState: activity.state,
            lastActivityAt: activity.lastActivityAt,
            toolCalls: toolCounts[sessionId]?.calls ?? null,
            toolFailures: toolCounts[sessionId]?.failures ?? null,
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
            recentEvents: agentEvts.slice(0, RECENT_EVENT_LIMIT),
            isToolRunning: agentToolRunning,
            currentToolName: agentToolName,
          },
        };
      }

      if (node.type === "developer") {
        const data = node.data as DeveloperNodeData;
        let activeCount = 0;
        let inactiveCount = 0;
        for (const session of activeSessions) {
          if (session.developerId !== data.developer.id) continue;
          const state = sessionActivity.get(session.id)?.state;
          if (state === "inactive") inactiveCount++;
          else if (state !== "ended") activeCount++;
        }
        return { ...node, data: { ...data, activeCount, inactiveCount } };
      }

      return node;
    });

    const edges = layoutEdges.map((edge) => {
      const sessionIds = (edge.data as FlowEdgeData | undefined)?.sessionIds;
      if (!sessionIds) return edge;
      const working = sessionIds.some((id) => {
        const state = sessionActivity.get(id)?.state;
        return state !== undefined && WORKING_STATES.has(state);
      });
      return { ...edge, animated: working };
    });

    return { nodes, edges };
  }, [positionedNodes, layoutEdges, events, allAgents, activeSessions, sessionActivity, toolCounts]);
}
