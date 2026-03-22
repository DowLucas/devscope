import type { WSContext } from "hono/ws";
import type { WsMessage } from "@devscope/shared";

// Org-scoped client tracking — survives bun --hot reloads via globalThis
const g = globalThis as any;

// orgId → Set of WS clients
const orgClients: Map<string, Set<WSContext>> =
  g.__gc_ws_org_clients ??= new Map<string, Set<WSContext>>();

// WS client → orgId (reverse lookup)
const clientOrg: Map<WSContext, string> =
  g.__gc_ws_client_org ??= new Map<WSContext, string>();

export function addClient(ws: WSContext, orgId?: string) {
  if (orgId) {
    let clients = orgClients.get(orgId);
    if (!clients) {
      clients = new Set();
      orgClients.set(orgId, clients);
    }
    clients.add(ws);
    clientOrg.set(ws, orgId);
  }
  clientLastPong.set(ws, Date.now());
  ws.send(JSON.stringify({ type: "connected", data: { clientCount: getClientCount() } }));
}

export function removeClient(ws: WSContext) {
  const orgId = clientOrg.get(ws);
  if (orgId) {
    const clients = orgClients.get(orgId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) orgClients.delete(orgId);
    }
    clientOrg.delete(ws);
  }
  clientLastPong.delete(ws);
}

export function recordPong(ws: WSContext) {
  clientLastPong.set(ws, Date.now());
}

export function broadcastToOrg(orgId: string, message: WsMessage) {
  const clients = orgClients.get(orgId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
      clientOrg.delete(client);
    }
  }
}

export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const [, clients] of orgClients) {
    for (const client of clients) {
      try {
        client.send(data);
      } catch {
        clients.delete(client);
        clientOrg.delete(client);
      }
    }
  }
}

export function getClientCount(): number {
  let count = 0;
  for (const clients of orgClients.values()) {
    count += clients.size;
  }
  return count;
}

export function getOrgClientCount(orgId: string): number {
  return orgClients.get(orgId)?.size ?? 0;
}

// Heartbeat: ping all clients every 30s, remove dead connections
// Track which clients responded to the last ping — clients that miss
// two consecutive pings are considered dead and removed.
const clientLastPong: Map<WSContext, number> =
  g.__gc_ws_client_pong ??= new Map<WSContext, number>();

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 65_000; // ~2 missed pings

if (g.__gc_ws_ping_interval) {
  clearInterval(g.__gc_ws_ping_interval);
}
g.__gc_ws_ping_interval = setInterval(() => {
  const now = Date.now();
  const ping = JSON.stringify({ type: "ping" });
  for (const [, clients] of orgClients) {
    for (const client of clients) {
      const lastPong = clientLastPong.get(client) ?? now;
      if (now - lastPong > PONG_TIMEOUT_MS) {
        // Client missed too many pings — remove it
        clients.delete(client);
        clientOrg.delete(client);
        clientLastPong.delete(client);
        try { client.close(); } catch { /* ignore */ }
        continue;
      }
      try {
        client.send(ping);
      } catch {
        clients.delete(client);
        clientOrg.delete(client);
        clientLastPong.delete(client);
      }
    }
  }
}, PING_INTERVAL_MS);
