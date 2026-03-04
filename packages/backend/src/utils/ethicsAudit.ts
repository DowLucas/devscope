import type { SQL } from "bun";

export type EthicsEventType =
  | "sensitive_fields_stripped"
  | "ai_individual_reference_blocked"
  | "privacy_mode_activated"
  | "data_request_processed"
  | "retention_purge_executed";

interface PendingAuditEvent {
  organization_id: string | null;
  event_type: EthicsEventType;
  details: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 50;

let pendingEvents: PendingAuditEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeSql: SQL | null = null;

async function flush() {
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0);
  const db = activeSql;
  if (!db) return;

  try {
    // Build a batch insert using individual INSERTs wrapped in a transaction
    await db.begin(async (tx) => {
      for (const evt of batch) {
        await tx`
          INSERT INTO ethics_audit_log (id, organization_id, event_type, details)
          VALUES (${crypto.randomUUID()}, ${evt.organization_id}, ${evt.event_type}, ${evt.details}::jsonb)`;
      }
    });
  } catch (err) {
    console.error("[ethics-audit] Failed to flush audit log:", err);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Log an ethics guardrail activation. Fire-and-forget — events are batched
 * and flushed every 5 seconds or when 50 events accumulate.
 */
export function logEthicsEvent(
  sql: SQL,
  orgId: string | null,
  eventType: EthicsEventType,
  details: Record<string, unknown> = {},
) {
  activeSql = sql;
  pendingEvents.push({
    organization_id: orgId,
    event_type: eventType,
    details,
  });

  if (pendingEvents.length >= FLUSH_THRESHOLD) {
    void flush();
  } else {
    scheduleFlush();
  }
}

/**
 * Force-flush any pending ethics audit events. Call on shutdown.
 */
export async function flushEthicsAudit() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}
