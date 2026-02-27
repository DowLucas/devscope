# Groundcontrol Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real-time developer activity monitoring dashboard that captures Claude Code hook events, stores them in a backend, and displays them in an animated web dashboard via WebSocket.

**Architecture:** Bun monorepo with 4 packages — shared types, Hono backend (REST + WebSocket + SQLite), React dashboard (Vite + Framer Motion), and a Claude Code plugin (bash hook scripts that POST events to the backend).

**Tech Stack:** Bun workspaces, Hono, SQLite (bun:sqlite), React 19, Vite, Framer Motion (motion), TailwindCSS, TypeScript

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/plugin/.claude-plugin/plugin.json`

**Step 1: Create root package.json with Bun workspaces**

```json
{
  "name": "groundcontrol",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:backend": "bun run --hot packages/backend/src/index.ts",
    "dev:dashboard": "bun run --filter dashboard dev",
    "dev": "bun run dev:backend & bun run dev:dashboard"
  }
}
```

**Step 2: Create .gitignore**

```
node_modules/
dist/
*.db
.DS_Store
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 4: Create packages/shared/package.json**

```json
{
  "name": "@groundcontrol/shared",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

**Step 5: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 6: Create packages/backend/package.json**

```json
{
  "name": "@groundcontrol/backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4",
    "@groundcontrol/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Step 7: Create packages/backend/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

**Step 8: Create packages/plugin/.claude-plugin/plugin.json**

```json
{
  "name": "groundcontrol",
  "version": "0.1.0",
  "description": "Real-time developer activity monitoring for Claude Code sessions"
}
```

**Step 9: Scaffold dashboard with Vite**

Run: `bun create vite packages/dashboard --template react-ts`

Then add dependencies:

Run:
```bash
cd packages/dashboard && bun add motion zustand @groundcontrol/shared && bun add -d tailwindcss @tailwindcss/vite
```

**Step 10: Run bun install at root**

Run: `cd /home/lucas/dev/projects/groundcontrol && bun install`
Expected: All workspace packages linked, node_modules created.

**Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold monorepo with bun workspaces"
```

---

### Task 2: Shared Types Package

**Files:**
- Create: `packages/shared/src/events.ts`
- Create: `packages/shared/src/models.ts`
- Create: `packages/shared/src/index.ts`

**Step 1: Create event types in packages/shared/src/events.ts**

```typescript
export type EventType =
  | "session.start"
  | "session.end"
  | "prompt.submit"
  | "tool.start"
  | "tool.complete"
  | "tool.fail"
  | "agent.start"
  | "agent.stop"
  | "response.complete";

export interface GroundcontrolEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  developerId: string;
  developerName: string;
  developerEmail: string;
  projectPath: string;
  projectName: string;
  eventType: EventType;
  payload: EventPayload;
}

export type EventPayload =
  | SessionStartPayload
  | SessionEndPayload
  | PromptEventPayload
  | ToolEventPayload
  | AgentEventPayload
  | ResponsePayload;

export interface SessionStartPayload {
  startType: string;
  permissionMode: string;
}

export interface SessionEndPayload {
  endReason: string;
  duration?: number;
}

export interface PromptEventPayload {
  promptContent: string;
  promptLength: number;
  isContinuation: boolean;
}

export interface ToolEventPayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
  duration?: number;
  success?: boolean;
}

export interface AgentEventPayload {
  agentType: string;
  agentId: string;
}

export interface ResponsePayload {
  responseLength?: number;
  toolsUsed: string[];
}
```

**Step 2: Create model types in packages/shared/src/models.ts**

```typescript
export interface Developer {
  id: string;
  name: string;
  email: string;
  firstSeen: string;
  lastSeen: string;
}

export interface Session {
  id: string;
  developerId: string;
  projectPath: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "ended";
  permissionMode: string | null;
}

export type WsMessageType =
  | "event.new"
  | "session.update"
  | "developer.update"
  | "subscribe"
  | "connected";

export interface WsMessage {
  type: WsMessageType;
  data: unknown;
}
```

**Step 3: Create barrel export in packages/shared/src/index.ts**

```typescript
export * from "./events";
export * from "./models";
```

**Step 4: Verify TypeScript compiles**

Run: `cd packages/shared && bunx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared types for events, models, and WebSocket messages"
```

---

### Task 3: Backend — SQLite Database Layer

**Files:**
- Create: `packages/backend/src/db/schema.ts`
- Create: `packages/backend/src/db/queries.ts`
- Create: `packages/backend/src/db/index.ts`

**Step 1: Create SQLite schema initialization in packages/backend/src/db/schema.ts**

```typescript
import { Database } from "bun:sqlite";

export function initializeDatabase(dbPath: string = "groundcontrol.db"): Database {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS developers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      developer_id TEXT NOT NULL REFERENCES developers(id),
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      permission_mode TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);

  return db;
}
```

**Step 2: Create query helpers in packages/backend/src/db/queries.ts**

```typescript
import { Database } from "bun:sqlite";
import type { GroundcontrolEvent } from "@groundcontrol/shared";

export function upsertDeveloper(
  db: Database,
  id: string,
  name: string,
  email: string
) {
  db.run(
    `INSERT INTO developers (id, name, email, first_seen, last_seen)
     VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = ?2,
       email = ?3,
       last_seen = datetime('now')`,
    [id, name, email]
  );
}

export function createSession(
  db: Database,
  id: string,
  developerId: string,
  projectPath: string,
  projectName: string,
  permissionMode: string | null
) {
  db.run(
    `INSERT OR IGNORE INTO sessions (id, developer_id, project_path, project_name, permission_mode)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    [id, developerId, projectPath, projectName, permissionMode]
  );
}

export function endSession(db: Database, id: string) {
  db.run(
    `UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`,
    [id]
  );
}

export function insertEvent(db: Database, event: GroundcontrolEvent) {
  db.run(
    `INSERT INTO events (id, session_id, event_type, payload, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    [event.id, event.sessionId, event.eventType, JSON.stringify(event.payload), event.timestamp]
  );
}

export function getActiveSessions(db: Database) {
  return db.query(
    `SELECT s.*, d.name as developer_name, d.email as developer_email
     FROM sessions s
     JOIN developers d ON s.developer_id = d.id
     WHERE s.status = 'active'
     ORDER BY s.started_at DESC`
  ).all();
}

export function getAllDevelopers(db: Database) {
  return db.query(
    `SELECT d.*,
       (SELECT COUNT(*) FROM sessions WHERE developer_id = d.id AND status = 'active') as active_sessions
     FROM developers d
     ORDER BY d.last_seen DESC`
  ).all();
}

export function getRecentEvents(db: Database, limit: number = 50) {
  return db.query(
    `SELECT e.*, s.project_name, d.name as developer_name, d.email as developer_email
     FROM events e
     JOIN sessions s ON e.session_id = s.id
     JOIN developers d ON s.developer_id = d.id
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).all(limit);
}

export function getSessionEvents(db: Database, sessionId: string) {
  return db.query(
    `SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId);
}

export function getAllSessions(db: Database, limit: number = 50) {
  return db.query(
    `SELECT s.*, d.name as developer_name, d.email as developer_email,
       (SELECT COUNT(*) FROM events WHERE session_id = s.id) as event_count
     FROM sessions s
     JOIN developers d ON s.developer_id = d.id
     ORDER BY s.started_at DESC
     LIMIT ?`
  ).all(limit);
}
```

**Step 3: Create db barrel export in packages/backend/src/db/index.ts**

```typescript
export { initializeDatabase } from "./schema";
export * from "./queries";
```

**Step 4: Verify TypeScript compiles**

Run: `cd packages/backend && bunx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add packages/backend/src/db
git commit -m "feat: add SQLite database layer with schema and queries"
```

---

### Task 4: Backend — WebSocket Handler

**Files:**
- Create: `packages/backend/src/ws/handler.ts`

**Step 1: Create WebSocket broadcast manager in packages/backend/src/ws/handler.ts**

```typescript
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
```

**Step 2: Commit**

```bash
git add packages/backend/src/ws
git commit -m "feat: add WebSocket broadcast manager"
```

---

### Task 5: Backend — Hono Routes

**Files:**
- Create: `packages/backend/src/routes/events.ts`
- Create: `packages/backend/src/routes/sessions.ts`
- Create: `packages/backend/src/routes/developers.ts`

**Step 1: Create events route in packages/backend/src/routes/events.ts**

```typescript
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { GroundcontrolEvent } from "@groundcontrol/shared";
import {
  upsertDeveloper,
  createSession,
  endSession,
  insertEvent,
  getRecentEvents,
} from "../db";
import { broadcast } from "../ws/handler";

export function eventsRoutes(db: Database) {
  const app = new Hono();

  app.post("/", async (c) => {
    const event = await c.req.json<GroundcontrolEvent>();

    upsertDeveloper(db, event.developerId, event.developerName, event.developerEmail);

    if (event.eventType === "session.start") {
      const payload = event.payload as { permissionMode?: string };
      createSession(
        db,
        event.sessionId,
        event.developerId,
        event.projectPath,
        event.projectName,
        payload.permissionMode ?? null
      );
      broadcast({ type: "session.update", data: { sessionId: event.sessionId, status: "active" } });
      broadcast({ type: "developer.update", data: { developerId: event.developerId } });
    } else if (event.eventType === "session.end") {
      endSession(db, event.sessionId);
      broadcast({ type: "session.update", data: { sessionId: event.sessionId, status: "ended" } });
      broadcast({ type: "developer.update", data: { developerId: event.developerId } });
    }

    insertEvent(db, event);

    broadcast({
      type: "event.new",
      data: event,
    });

    return c.json({ ok: true });
  });

  app.get("/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const events = getRecentEvents(db, limit);
    return c.json(events);
  });

  return app;
}
```

**Step 2: Create sessions route in packages/backend/src/routes/sessions.ts**

```typescript
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getActiveSessions, getAllSessions, getSessionEvents } from "../db";

export function sessionsRoutes(db: Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(getAllSessions(db, limit));
  });

  app.get("/active", (c) => {
    return c.json(getActiveSessions(db));
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const events = getSessionEvents(db, id);
    return c.json({ sessionId: id, events });
  });

  return app;
}
```

**Step 3: Create developers route in packages/backend/src/routes/developers.ts**

```typescript
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getAllDevelopers } from "../db";

export function developersRoutes(db: Database) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json(getAllDevelopers(db));
  });

  return app;
}
```

**Step 4: Commit**

```bash
git add packages/backend/src/routes
git commit -m "feat: add Hono REST routes for events, sessions, and developers"
```

---

### Task 6: Backend — Main Entry Point

**Files:**
- Create: `packages/backend/src/index.ts`

**Step 1: Create server entry point in packages/backend/src/index.ts**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { upgradeWebSocket, websocket } from "hono/bun";
import { initializeDatabase } from "./db";
import { eventsRoutes } from "./routes/events";
import { sessionsRoutes } from "./routes/sessions";
import { developersRoutes } from "./routes/developers";
import { addClient, removeClient, getClientCount } from "./ws/handler";

const db = initializeDatabase();
const app = new Hono();

app.use("/api/*", cors({ origin: "*" }));

app.route("/api/events", eventsRoutes(db));
app.route("/api/sessions", sessionsRoutes(db));
app.route("/api/developers", developersRoutes(db));

app.get("/api/health", (c) =>
  c.json({ status: "ok", clients: getClientCount() })
);

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      addClient(ws);
      console.log("[ws] Client connected (" + getClientCount() + " total)");
    },
    onMessage(event, _ws) {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "subscribe") {
          console.log("[ws] Client subscribed");
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    onClose(_event, ws) {
      removeClient(ws);
      console.log("[ws] Client disconnected (" + getClientCount() + " total)");
    },
  }))
);

const PORT = Number(process.env.PORT ?? 3001);

console.log("[groundcontrol] Backend running on http://localhost:" + PORT);
console.log("[groundcontrol] WebSocket on ws://localhost:" + PORT + "/ws");

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
```

**Step 2: Test the server starts**

Run: `cd packages/backend && bun run src/index.ts`
Expected: Prints backend and WebSocket URLs.

**Step 3: Test health endpoint**

Run: `curl http://localhost:3001/api/health`
Expected: `{"status":"ok","clients":0}`

**Step 4: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: add backend entry point with Hono REST + WebSocket server"
```

---

### Task 7: Claude Code Plugin — Hook Scripts

**Files:**
- Create: `packages/plugin/hooks/hooks.json`
- Create: `packages/plugin/scripts/send-event.sh`
- Create: `packages/plugin/scripts/session-start.sh`
- Create: `packages/plugin/scripts/session-end.sh`
- Create: `packages/plugin/scripts/prompt-submit.sh`
- Create: `packages/plugin/scripts/tool-use.sh`
- Create: `packages/plugin/scripts/tool-complete.sh`
- Create: `packages/plugin/scripts/agent-start.sh`
- Create: `packages/plugin/scripts/agent-stop.sh`
- Create: `packages/plugin/scripts/response-stop.sh`

**Step 1: Create the common event sender script at packages/plugin/scripts/send-event.sh**

```bash
#!/usr/bin/env bash
# Common event sender for Groundcontrol
# Usage: echo '{"hook_input":"..."}' | send-event.sh <event_type> '<payload_json>'
set -euo pipefail

GROUNDCONTROL_URL="${GROUNDCONTROL_URL:-http://localhost:3001}"
EVENT_TYPE="$1"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_NAME=$(basename "$CWD" 2>/dev/null || echo "unknown")

DEV_NAME=$(git -C "$CWD" config user.name 2>/dev/null || echo "$USER")
DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
DEV_ID=$(echo -n "$DEV_EMAIL" | sha256sum | cut -d' ' -f1)

PAYLOAD="${2:-$(echo "$INPUT" | jq -c '{raw: .}')}"

EVENT_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "evt-$(date +%s%N)")

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

EVENT=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg ts "$TIMESTAMP" \
  --arg sid "$SESSION_ID" \
  --arg did "$DEV_ID" \
  --arg dname "$DEV_NAME" \
  --arg demail "$DEV_EMAIL" \
  --arg ppath "$CWD" \
  --arg pname "$PROJECT_NAME" \
  --arg etype "$EVENT_TYPE" \
  --argjson payload "$PAYLOAD" \
  '{
    id: $id,
    timestamp: $ts,
    sessionId: $sid,
    developerId: $did,
    developerName: $dname,
    developerEmail: $demail,
    projectPath: $ppath,
    projectName: $pname,
    eventType: $etype,
    payload: $payload
  }')

curl -s -X POST "${GROUNDCONTROL_URL}/api/events" \
  -H "Content-Type: application/json" \
  -d "$EVENT" \
  --max-time 5 \
  -o /dev/null 2>/dev/null || true

exit 0
```

**Step 2: Create session-start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

START_TYPE=$(echo "$INPUT" | jq -r '.source // "startup"')
PERM_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')

PAYLOAD=$(jq -n --arg st "$START_TYPE" --arg pm "$PERM_MODE" \
  '{startType: $st, permissionMode: $pm}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.start" "$PAYLOAD"
```

**Step 3: Create session-end.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

END_REASON=$(echo "$INPUT" | jq -r '.source // "other"')

PAYLOAD=$(jq -n --arg er "$END_REASON" '{endReason: $er}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.end" "$PAYLOAD"
```

**Step 4: Create prompt-submit.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
PROMPT_LEN=${#PROMPT}
IS_CONT=$(echo "$INPUT" | jq -r '.is_continuation // false')

PAYLOAD=$(jq -n \
  --arg pc "$PROMPT" \
  --argjson pl "$PROMPT_LEN" \
  --argjson ic "$IS_CONT" \
  '{promptContent: $pc, promptLength: $pl, isContinuation: $ic}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "prompt.submit" "$PAYLOAD"
```

**Step 5: Create tool-use.sh (PreToolUse)**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  --argjson ti "$TOOL_INPUT" \
  '{toolName: $tn, toolInput: $ti}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "tool.start" "$PAYLOAD"
```

**Step 6: Create tool-complete.sh (PostToolUse / PostToolUseFailure)**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "PostToolUse"')

if [ "$HOOK_EVENT" = "PostToolUseFailure" ]; then
  SUCCESS=false
  EVENT_TYPE="tool.fail"
else
  SUCCESS=true
  EVENT_TYPE="tool.complete"
fi

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  --argjson ti "$TOOL_INPUT" \
  --argjson s "$SUCCESS" \
  '{toolName: $tn, toolInput: $ti, success: $s}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "$EVENT_TYPE" "$PAYLOAD"
```

**Step 7: Create agent-start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')

PAYLOAD=$(jq -n --arg at "$AGENT_TYPE" --arg ai "$AGENT_ID" \
  '{agentType: $at, agentId: $ai}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "agent.start" "$PAYLOAD"
```

**Step 8: Create agent-stop.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')

PAYLOAD=$(jq -n --arg at "$AGENT_TYPE" --arg ai "$AGENT_ID" \
  '{agentType: $at, agentId: $ai}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "agent.stop" "$PAYLOAD"
```

**Step 9: Create response-stop.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

PAYLOAD=$(jq -n '{toolsUsed: []}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "response.complete" "$PAYLOAD"
```

**Step 10: Create hooks.json at packages/plugin/hooks/hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh",
            "async": true
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-end.sh",
            "async": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/prompt-submit.sh",
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-use.sh",
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-complete.sh",
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-complete.sh",
            "async": true
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/agent-start.sh",
            "async": true
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/agent-stop.sh",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/response-stop.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Step 11: Make all scripts executable**

Run: `chmod +x packages/plugin/scripts/*.sh`

**Step 12: Test a hook script manually**

Run:
```bash
echo '{"session_id":"test-123","cwd":"/home/lucas/dev/projects/groundcontrol","permission_mode":"default","source":"startup"}' | packages/plugin/scripts/session-start.sh
```
Expected: Script exits 0 (curl failure silently ignored if backend not running).

**Step 13: Commit**

```bash
git add packages/plugin
git commit -m "feat: add Claude Code plugin with all hook scripts"
```

---

### Task 8: Dashboard — Vite + Tailwind Configuration

**Files:**
- Modify: `packages/dashboard/vite.config.ts`
- Modify: `packages/dashboard/src/index.css`

**Step 1: Configure Vite with Tailwind and proxy**

Replace `packages/dashboard/vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

**Step 2: Add Tailwind import to index.css**

Replace `packages/dashboard/src/index.css` with:

```css
@import "tailwindcss";
```

**Step 3: Verify dashboard starts**

Run: `cd packages/dashboard && bun run dev`
Expected: Vite dev server on http://localhost:5173

**Step 4: Commit**

```bash
git add packages/dashboard
git commit -m "feat: configure dashboard with Tailwind and API proxy"
```

---

### Task 9: Dashboard — Zustand Store + WebSocket Hook

**Files:**
- Create: `packages/dashboard/src/stores/activityStore.ts`
- Create: `packages/dashboard/src/hooks/useWebSocket.ts`

**Step 1: Create Zustand activity store at packages/dashboard/src/stores/activityStore.ts**

```typescript
import { create } from "zustand";
import type { GroundcontrolEvent, Developer, Session } from "@groundcontrol/shared";

interface ActivityState {
  events: GroundcontrolEvent[];
  developers: (Developer & { active_sessions?: number })[];
  activeSessions: Session[];
  connected: boolean;

  addEvent: (event: GroundcontrolEvent) => void;
  setDevelopers: (devs: Developer[]) => void;
  setActiveSessions: (sessions: Session[]) => void;
  setConnected: (connected: boolean) => void;
  setEvents: (events: GroundcontrolEvent[]) => void;
  updateSession: (sessionId: string, status: string) => void;
}

const MAX_EVENTS = 200;

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  developers: [],
  activeSessions: [],
  connected: false,

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, MAX_EVENTS),
    })),

  setDevelopers: (developers) => set({ developers }),
  setActiveSessions: (activeSessions) => set({ activeSessions }),
  setConnected: (connected) => set({ connected }),
  setEvents: (events) => set({ events }),

  updateSession: (sessionId, status) =>
    set((state) => ({
      activeSessions:
        status === "ended"
          ? state.activeSessions.filter((s) => s.id !== sessionId)
          : state.activeSessions,
    })),
}));
```

**Step 2: Create WebSocket hook at packages/dashboard/src/hooks/useWebSocket.ts**

```typescript
import { useEffect, useRef } from "react";
import { useActivityStore } from "../stores/activityStore";

export function useGroundcontrolSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
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
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/stores packages/dashboard/src/hooks
git commit -m "feat: add WebSocket hook and Zustand activity store"
```

---

### Task 10: Dashboard — UI Components

**Files:**
- Create: `packages/dashboard/src/components/Layout.tsx`
- Create: `packages/dashboard/src/components/EventCard.tsx`
- Create: `packages/dashboard/src/components/LiveFeed.tsx`
- Create: `packages/dashboard/src/components/DeveloperCards.tsx`
- Create: `packages/dashboard/src/components/SessionTimeline.tsx`
- Modify: `packages/dashboard/src/App.tsx`

**Step 1: Create Layout at packages/dashboard/src/components/Layout.tsx**

```tsx
import { type ReactNode } from "react";
import { useActivityStore } from "../stores/activityStore";

interface LayoutProps {
  children: ReactNode;
  activeView: string;
  onViewChange: (view: string) => void;
}

export function Layout({ children, activeView, onViewChange }: LayoutProps) {
  const { connected, activeSessions } = useActivityStore();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Groundcontrol</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-gray-400">
            {activeSessions.length} active
          </span>
        </div>
      </header>

      <div className="flex">
        <nav className="w-48 border-r border-gray-800 p-4 space-y-1">
          {[
            { id: "feed", label: "Live Feed" },
            { id: "developers", label: "Developers" },
            { id: "history", label: "History" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeView === item.id
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Step 2: Create EventCard at packages/dashboard/src/components/EventCard.tsx**

```tsx
import { motion } from "motion/react";
import type { GroundcontrolEvent } from "@groundcontrol/shared";

const EVENT_COLORS: Record<string, string> = {
  "session.start": "border-emerald-500/50 bg-emerald-500/5",
  "session.end": "border-gray-500/50 bg-gray-500/5",
  "prompt.submit": "border-blue-500/50 bg-blue-500/5",
  "tool.start": "border-amber-500/50 bg-amber-500/5",
  "tool.complete": "border-green-500/50 bg-green-500/5",
  "tool.fail": "border-red-500/50 bg-red-500/5",
  "agent.start": "border-purple-500/50 bg-purple-500/5",
  "agent.stop": "border-purple-500/30 bg-purple-500/5",
  "response.complete": "border-cyan-500/50 bg-cyan-500/5",
};

const EVENT_LABELS: Record<string, string> = {
  "session.start": "Session Started",
  "session.end": "Session Ended",
  "prompt.submit": "Prompt",
  "tool.start": "Tool Started",
  "tool.complete": "Tool Completed",
  "tool.fail": "Tool Failed",
  "agent.start": "Agent Spawned",
  "agent.stop": "Agent Finished",
  "response.complete": "Response Complete",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getEventSummary(event: GroundcontrolEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.eventType) {
    case "tool.start":
    case "tool.complete":
    case "tool.fail":
      return String(p.toolName ?? "Unknown tool");
    case "prompt.submit": {
      const content = String(p.promptContent ?? "");
      return content.slice(0, 80) + (content.length > 80 ? "..." : "");
    }
    case "session.start":
      return "Started (" + (p.startType ?? "startup") + ")";
    case "session.end":
      return "Ended (" + (p.endReason ?? "unknown") + ")";
    case "agent.start":
    case "agent.stop":
      return String(p.agentType ?? "Agent");
    default:
      return event.eventType;
  }
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  return hours + "h ago";
}

export function EventCard({ event }: { event: GroundcontrolEvent }) {
  const colorClass = EVENT_COLORS[event.eventType] ?? "border-gray-500/50 bg-gray-500/5";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={"border rounded-lg p-3 " + colorClass}
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold shrink-0">
          {getInitials(event.developerName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{event.developerName}</span>
            <span className="text-gray-500">in</span>
            <span className="text-gray-300 font-mono text-xs">{event.projectName}</span>
          </div>
          <div className="text-sm text-gray-400 truncate">
            <span className="text-gray-500">{EVENT_LABELS[event.eventType] ?? event.eventType}:</span>{" "}
            {getEventSummary(event)}
          </div>
        </div>
        <span className="text-xs text-gray-600 shrink-0">{timeAgo(event.timestamp)}</span>
      </div>
    </motion.div>
  );
}
```

**Step 3: Create LiveFeed at packages/dashboard/src/components/LiveFeed.tsx**

```tsx
import { AnimatePresence } from "motion/react";
import { useActivityStore } from "../stores/activityStore";
import { EventCard } from "./EventCard";

export function LiveFeed() {
  const events = useActivityStore((s) => s.events);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Live Activity Feed</h2>
      {events.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No events yet. Start a Claude Code session with the Groundcontrol plugin enabled.
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
```

**Step 4: Create DeveloperCards at packages/dashboard/src/components/DeveloperCards.tsx**

```tsx
import { motion } from "motion/react";
import { useActivityStore } from "../stores/activityStore";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function DeveloperCards() {
  const developers = useActivityStore((s) => s.developers);

  if (developers.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Developers</h2>
        <div className="text-gray-500 text-center py-12">No developers tracked yet.</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Developers</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {developers.map((dev) => {
          const isActive = (dev.active_sessions ?? 0) > 0;
          return (
            <motion.div
              key={dev.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={"border rounded-xl p-4 transition-colors " +
                (isActive
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-gray-800 bg-gray-900/50"
                )
              }
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <div className="h-10 w-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold">
                    {getInitials(dev.name)}
                  </div>
                  {isActive && (
                    <motion.div
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-gray-950"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    />
                  )}
                </div>
                <div>
                  <div className="font-medium">{dev.name}</div>
                  <div className="text-xs text-gray-500">{dev.email}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                {isActive ? (
                  <span className="text-emerald-400">
                    {dev.active_sessions} active session{(dev.active_sessions ?? 0) !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span>Last seen: {new Date(dev.lastSeen ?? (dev as any).last_seen).toLocaleDateString()}</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 5: Create SessionTimeline at packages/dashboard/src/components/SessionTimeline.tsx**

```tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface SessionRow {
  id: string;
  developer_name: string;
  project_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  event_count: number;
}

export function SessionTimeline() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sessions?limit=50")
      .then((r) => r.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-gray-500 text-center py-12">Loading sessions...</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Session History</h2>
      {sessions.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No sessions recorded yet.</div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {sessions.map((session, i) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={"border rounded-lg p-4 " +
                  (session.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-gray-800 bg-gray-900/50"
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{session.developer_name}</span>
                    <span className="text-gray-500 mx-2">in</span>
                    <span className="font-mono text-sm text-gray-300">{session.project_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500">{session.event_count} events</span>
                    <span
                      className={"px-2 py-0.5 rounded-full text-xs " +
                        (session.status === "active"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-gray-800 text-gray-400"
                        )
                      }
                    >
                      {session.status}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Started {new Date(session.started_at).toLocaleString()}
                  {session.ended_at && (" - Ended " + new Date(session.ended_at).toLocaleString())}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
```

**Step 6: Wire up App.tsx - replace packages/dashboard/src/App.tsx**

```tsx
import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { LiveFeed } from "./components/LiveFeed";
import { DeveloperCards } from "./components/DeveloperCards";
import { SessionTimeline } from "./components/SessionTimeline";
import { useGroundcontrolSocket } from "./hooks/useWebSocket";
import { useActivityStore } from "./stores/activityStore";

function App() {
  const [activeView, setActiveView] = useState("feed");
  useGroundcontrolSocket();

  const { setDevelopers, setActiveSessions, setEvents } = useActivityStore();

  useEffect(() => {
    fetch("/api/developers")
      .then((r) => r.json())
      .then(setDevelopers)
      .catch(() => {});

    fetch("/api/sessions/active")
      .then((r) => r.json())
      .then(setActiveSessions)
      .catch(() => {});

    fetch("/api/events/recent?limit=50")
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {});
  }, [setDevelopers, setActiveSessions, setEvents]);

  return (
    <Layout activeView={activeView} onViewChange={setActiveView}>
      {activeView === "feed" && <LiveFeed />}
      {activeView === "developers" && <DeveloperCards />}
      {activeView === "history" && <SessionTimeline />}
    </Layout>
  );
}

export default App;
```

**Step 7: Commit**

```bash
git add packages/dashboard/src
git commit -m "feat: add dashboard components with Framer Motion animations"
```

---

### Task 11: Integration Test — End-to-End Smoke Test

**Step 1: Start the backend**

Run: `bun run dev:backend`
Expected: "Backend running on http://localhost:3001"

**Step 2: Start the dashboard (separate terminal)**

Run: `bun run dev:dashboard`
Expected: Vite dev server on http://localhost:5173

**Step 3: Send a test session.start event**

Run:
```bash
curl -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{"id":"test-001","timestamp":"2026-02-27T12:00:00.000Z","sessionId":"sess-001","developerId":"dev-abc123","developerName":"Lucas","developerEmail":"lucas@example.com","projectPath":"/home/lucas/dev/projects/groundcontrol","projectName":"groundcontrol","eventType":"session.start","payload":{"startType":"startup","permissionMode":"default"}}'
```
Expected: `{"ok":true}`

**Step 4: Send a test tool.start event**

Run:
```bash
curl -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{"id":"test-002","timestamp":"2026-02-27T12:00:05.000Z","sessionId":"sess-001","developerId":"dev-abc123","developerName":"Lucas","developerEmail":"lucas@example.com","projectPath":"/home/lucas/dev/projects/groundcontrol","projectName":"groundcontrol","eventType":"tool.start","payload":{"toolName":"Bash","toolInput":{"command":"bun test"}}}'
```

**Step 5: Verify dashboard**

Open http://localhost:5173 and verify:
- "Connected" indicator in header
- "1 active session" count
- Events appearing in the Live Feed
- Lucas appearing in Developers view

**Step 6: Test a hook script against running backend**

Run:
```bash
echo '{"session_id":"hook-test-001","cwd":"/home/lucas/dev/projects/groundcontrol","permission_mode":"default","source":"startup"}' | packages/plugin/scripts/session-start.sh
```
Expected: New event appears on dashboard in real-time.

**Step 7: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 12: Final Cleanup

**Step 1: Remove Vite boilerplate files**

Delete: `packages/dashboard/src/App.css`, `packages/dashboard/src/assets/react.svg`, `packages/dashboard/public/vite.svg`

**Step 2: Final commit**

```bash
git add -A
git commit -m "chore: remove boilerplate and finalize MVP"
```
