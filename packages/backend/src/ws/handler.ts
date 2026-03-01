import type { WSContext } from "hono/ws";
import type { WsMessage } from "@devscope/shared";

// Use globalThis to survive bun --hot reloads, so existing WS
// connections stay tracked after a module re-execution.
const clients: Set<WSContext> =
  (globalThis as any).__gc_ws_clients ??= new Set<WSContext>();

export function addClient(ws: WSContext) {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "connected", data: { clientCount: clients.size } }));
}

export function removeClient(ws: WSContext) {
  clients.delete(ws);
}

export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

// Heartbeat: ping all clients every 30s, remove dead connections.
// Uses globalThis guard to avoid duplicate intervals on hot reload.
const PING_INTERVAL_MS = 30_000;
const g = globalThis as any;
if (g.__gc_ws_ping_interval) {
  clearInterval(g.__gc_ws_ping_interval);
}
g.__gc_ws_ping_interval = setInterval(() => {
  const ping = JSON.stringify({ type: "ping" });
  for (const client of clients) {
    try {
      client.send(ping);
    } catch {
      clients.delete(client);
    }
  }
}, PING_INTERVAL_MS);
