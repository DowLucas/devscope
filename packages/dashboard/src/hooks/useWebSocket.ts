import { useEffect, useRef } from "react";
import { useActivityStore, type ActiveAgent } from "@/stores/activityStore";
import { apiFetch } from "@/lib/api";
import type { Developer, Session } from "@devscope/shared";

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

export function useDevscopeSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const connectionIdRef = useRef(0);

  useEffect(() => {
    // Each effect invocation gets a unique ID. Old WS callbacks that
    // captured a previous ID will see a mismatch and bail out,
    // preventing the race where old onclose overwrites new state.
    const connectionId = ++connectionIdRef.current;
    const isStale = () => connectionId !== connectionIdRef.current;

    function connect() {
      if (isStale()) return;
      const envWsUrl = import.meta.env.VITE_WS_URL;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = envWsUrl || protocol + "//" + window.location.host + "/ws";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isStale()) return;
        reconnectDelay.current = RECONNECT_BASE_MS;
        const s = useActivityStore.getState();
        s.setConnected(true);
        s.bumpFetchGeneration();
        ws.send(JSON.stringify({ type: "subscribe" }));
      };

      ws.onmessage = (e) => {
        if (isStale()) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
          const store = useActivityStore.getState();
          switch (msg.type) {
            case "event.new":
              store.addEvent(msg.data);
              if (msg.data.eventType === "agent.start" && msg.data.payload?.agentId) {
                store.addActiveAgent({
                  agentId: msg.data.payload.agentId,
                  agentType: msg.data.payload.agentType || "agent",
                  sessionId: msg.data.sessionId,
                  startedAt: msg.data.timestamp,
                });
              } else if (msg.data.eventType === "agent.stop" && msg.data.payload?.agentId) {
                store.removeActiveAgent(msg.data.payload.agentId);
              }
              break;
            case "session.update":
              store.updateSession(msg.data.sessionId, msg.data.status);
              break;
            case "developer.update":
              Promise.all([
                apiFetch("/api/developers").then((r) => r.json()),
                apiFetch("/api/sessions/active").then((r) => r.json()),
              ]).then(([devs, sessions]: [Developer[], (Session & { activeAgents?: ActiveAgent[] })[]]) => {
                if (isStale()) return;
                const apiAgents = sessions
                  .flatMap((s) => s.activeAgents ?? [])
                  .filter((a) => a.agentId != null);
                // Merge: API is authoritative, but preserve real-time agents
                // not yet reflected in API (race between broadcast and DB insert)
                const apiAgentIds = new Set(apiAgents.map((a) => a.agentId));
                const realtimeOnly = useActivityStore.getState().activeAgents
                  .filter((a) => !apiAgentIds.has(a.agentId));
                useActivityStore.setState({
                  developers: devs,
                  activeAgents: [...apiAgents, ...realtimeOnly],
                  activeSessions: sessions,
                });
              }).catch(() => {
                // Fetch failures are expected during backend restarts;
                // the next WebSocket reconnect will trigger another developer.update
              });
              break;
            case "session.title.update":
              store.updateSessionTitle(msg.data.sessionId, msg.data.title);
              break;
            case "alert.triggered":
              store.addAlert(msg.data);
              break;
            case "friction.alert":
              store.addFrictionAlert(msg.data);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (isStale()) return;
        useActivityStore.getState().setConnected(false);
        reconnectTimer.current = setTimeout(connect, reconnectDelay.current);
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);
}
