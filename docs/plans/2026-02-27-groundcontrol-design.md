# Groundcontrol - Design Document

**Date:** 2026-02-27
**Author:** Lucas
**Status:** Approved

## Overview

Groundcontrol is a real-time developer activity monitoring dashboard built on top of Claude Code's hooks system. It captures events from Claude Code sessions across a team, aggregates them in a backend API, and displays them in an animated web dashboard connected via WebSocket. Target users: CTOs, engineering managers, and team leads who want visibility into what their team is working on.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Plugin | Claude Code plugin (bash hook scripts) |
| Backend | Bun + Hono (REST API + WebSocket on single port) |
| Database | SQLite (via Bun's built-in driver) |
| Frontend | React + Vite + Framer Motion |
| Types | Shared TypeScript package |
| Monorepo | Bun workspaces |

## Architecture

```
┌─────────────────────┐     HTTP POST      ┌──────────────────────┐     WebSocket     ┌─────────────────────┐
│  Claude Code Plugin │ ──────────────────► │  Bun + Hono Backend  │ ◄──────────────── │  React Dashboard    │
│  (hooks/scripts)    │   /api/events       │  SQLite + WS Server  │   ws://localhost   │  Vite + Framer      │
└─────────────────────┘                     └──────────────────────┘                    └─────────────────────┘
```

- All hooks are **async** (non-blocking to developer workflow)
- Backend serves REST + WebSocket on a single port (default: 3001)
- SQLite for persistence, no external database for MVP
- Developer identity extracted from `git config user.name` and `git config user.email` at SessionStart

## Project Structure

```
groundcontrol/
├── packages/
│   ├── plugin/              # Claude Code plugin
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── hooks/
│   │   │   └── hooks.json
│   │   └── scripts/
│   │       ├── send-event.sh      # Common event sender
│   │       ├── session-start.sh
│   │       ├── session-end.sh
│   │       ├── prompt-submit.sh
│   │       ├── tool-use.sh
│   │       ├── tool-complete.sh
│   │       ├── agent-start.sh
│   │       ├── agent-stop.sh
│   │       └── response-stop.sh
│   ├── backend/             # Bun + Hono API
│   │   ├── src/
│   │   │   ├── index.ts          # Entry point
│   │   │   ├── routes/
│   │   │   │   ├── events.ts     # POST /api/events
│   │   │   │   ├── sessions.ts   # GET /api/sessions
│   │   │   │   └── developers.ts # GET /api/developers
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # SQLite schema
│   │   │   │   └── queries.ts    # Query helpers
│   │   │   └── ws/
│   │   │       └── handler.ts    # WebSocket broadcast
│   │   └── package.json
│   ├── dashboard/           # React + Vite frontend
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── LiveFeed.tsx
│   │   │   │   ├── DeveloperCards.tsx
│   │   │   │   ├── SessionTimeline.tsx
│   │   │   │   ├── EventCard.tsx
│   │   │   │   └── Layout.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useWebSocket.ts
│   │   │   ├── stores/
│   │   │   │   └── activityStore.ts
│   │   │   └── types/
│   │   └── package.json
│   └── shared/              # Shared TypeScript types
│       ├── src/
│       │   ├── events.ts
│       │   ├── models.ts
│       │   └── index.ts
│       └── package.json
├── package.json             # Workspace root
└── tsconfig.base.json
```

## Data Model

### Event Envelope

```typescript
interface GroundcontrolEvent {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  sessionId: string;             // From Claude Code
  developerId: string;           // Hash of git email
  developerName: string;         // git user.name
  developerEmail: string;        // git user.email
  projectPath: string;           // cwd
  projectName: string;           // basename of cwd
  eventType: EventType;
  payload: EventPayload;
}

type EventType =
  | 'session.start' | 'session.end'
  | 'prompt.submit'
  | 'tool.start' | 'tool.complete' | 'tool.fail'
  | 'agent.start' | 'agent.stop'
  | 'response.complete';
```

### Event Payloads (Full Capture Mode)

```typescript
interface SessionStartPayload {
  startType: string;             // startup, resume, compact
  permissionMode: string;
}

interface SessionEndPayload {
  endReason: string;
  duration: number;              // ms
}

interface PromptEventPayload {
  promptContent: string;         // Full prompt text
  promptLength: number;
  isContinuation: boolean;
}

interface ToolEventPayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;           // Truncated at 10KB
  duration?: number;
  success?: boolean;
}

interface AgentEventPayload {
  agentType: string;
  agentId: string;
}

interface ResponsePayload {
  responseLength: number;
  toolsUsed: string[];
}
```

### SQLite Schema

```sql
CREATE TABLE developers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id),
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT DEFAULT 'active',
  permission_mode TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_sessions_developer ON sessions(developer_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

## Plugin Hook Configuration

All hooks fire async to avoid blocking the developer:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh", "async": true }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-end.sh", "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/prompt-submit.sh", "async": true }] }],
    "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-use.sh", "async": true }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-complete.sh", "async": true }] }],
    "PostToolUseFailure": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/tool-complete.sh", "async": true }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/agent-start.sh", "async": true }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/agent-stop.sh", "async": true }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/response-stop.sh", "async": true }] }]
  }
}
```

## API Endpoints

### REST (Hono)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/events | Receive events from plugin hooks |
| GET | /api/developers | List all developers |
| GET | /api/developers/:id | Get developer detail |
| GET | /api/sessions | List sessions (filterable) |
| GET | /api/sessions/:id | Get session with events |
| GET | /api/sessions/active | Get currently active sessions |
| GET | /api/events/recent | Recent events (for initial dashboard load) |

### WebSocket

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| event.new | Server → Client | New event received |
| session.update | Server → Client | Session status changed |
| developer.update | Server → Client | Developer status changed |
| subscribe | Client → Server | Subscribe to event stream |

## Dashboard Views

### 1. Live Activity Feed (Default)
- Real-time scrolling feed of events across the team
- AnimatePresence for smooth entry/exit animations
- Color-coded by event type
- Each card: developer initials, timestamp, event summary, project name

### 2. Developer Cards Grid
- Card per developer: name, status (active/idle), project, session duration, recent tools
- Pulse animation on active developers
- Click to expand detailed activity view

### 3. Session Timeline
- Horizontal timeline per session
- Tool types as colored markers
- Expandable event details (prompt content, tool I/O)
- Filter by developer, project, date range

## Communication Flow

1. Developer starts Claude Code session
2. SessionStart hook fires → extracts git info → POST to backend
3. Backend creates/updates developer record, creates session
4. Backend broadcasts `session.update` via WebSocket
5. Developer submits prompts, uses tools → hooks fire → POST events
6. Backend stores events, broadcasts via WebSocket
7. Dashboard receives WebSocket messages, animates new data
8. Developer ends session → SessionEnd hook → backend marks session inactive

## Future Considerations (Not in MVP)

- GitHub/Jira MCP integration for correlating Claude activity with tickets
- Authentication and team management
- Cost tracking (token usage)
- Configurable capture levels (metadata-only vs full capture)
- Alerts and notifications (Slack integration)
- Historical analytics and reporting
