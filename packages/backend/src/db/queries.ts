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
