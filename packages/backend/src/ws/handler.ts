import type { WSContext } from "hono/ws";
import type { WsMessage } from "@groundcontrol/shared";

const clients = new Set<WSContext>();

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
