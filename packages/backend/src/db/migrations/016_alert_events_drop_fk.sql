-- Drop the foreign key constraint on alert_events.rule_id so that
-- auto-generated tooling-health alerts don't need a matching alert_rules row.
ALTER TABLE alert_events DROP CONSTRAINT IF EXISTS alert_events_rule_id_fkey;
