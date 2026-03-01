-- Fix double-encoded JSONB payloads in events table.
-- insertEvent() was using JSON.stringify() + ::jsonb cast, which stored
-- the payload as a JSONB string type instead of a JSONB object.
UPDATE events
SET payload = (payload #>> '{}')::jsonb
WHERE jsonb_typeof(payload) = 'string';

-- Same issue in digests table summary column.
UPDATE digests
SET summary = (summary #>> '{}')::jsonb
WHERE jsonb_typeof(summary) = 'string';
