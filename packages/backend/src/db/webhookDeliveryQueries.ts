import type { SQL } from "bun";

/**
 * Idempotent webhook delivery dedup. Returns true if this delivery_id was
 * newly inserted (caller should process the event), false if it was a
 * duplicate (caller should skip).
 *
 * Implemented as a single INSERT … ON CONFLICT DO NOTHING RETURNING — the
 * RETURNING row only appears when the insert actually happened.
 */
export async function recordDelivery(
  sql: SQL,
  deliveryId: string,
  event: string
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO webhook_deliveries (delivery_id, event)
    VALUES (${deliveryId}, ${event})
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING delivery_id`;
  return (rows as unknown[]).length > 0;
}
