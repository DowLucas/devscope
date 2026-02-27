import { useEffect, useRef } from "react";
import { useActivityStore } from "../stores/activityStore";

export function useGroundcontrolSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { addEvent, setConnected, updateSession } = useActivityStore();

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = protocol + "//" + window.location.host + "/ws";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe" }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "event.new":
              addEvent(msg.data);
              break;
            case "session.update":
              updateSession(msg.data.sessionId, msg.data.status);
              break;
            case "developer.update":
              fetch("/api/developers")
                .then((r) => r.json())
                .then((devs) => useActivityStore.getState().setDevelopers(devs));
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 3000);
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
  }, [addEvent, setConnected, updateSession]);
}
