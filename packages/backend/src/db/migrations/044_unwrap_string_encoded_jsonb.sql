-- Unwrap jsonb columns that were stored as JSON *strings*.
--
-- Writers did `${JSON.stringify(x)}::jsonb`. Bun.sql binds a JS string as a
-- JSON string, so each value landed as a jsonb scalar string holding the JSON
-- text (jsonb_typeof = 'string'), not the object. Readers then got a JS
-- string: field access yielded undefined (friction rule config fell back to
-- hard-coded defaults, playbook metrics never rendered) and SQL ->> yielded
-- NULL (the session-feedback cache never matched). Same fault and same fix as
-- migrations 003 and 043; the writers now bind objects.
--
-- Two wrinkles handled here:
--   * A value re-stringified before writing (session_patterns' update path
--     stringified an already-string value) is nested more than once, so each
--     column is unwrapped until nothing changes.
--   * team_skills refinement spread the string into an object, producing
--     {"0":"{","1":"\"",...}. The digit keys spell the original JSON in order,
--     so it is reassembled and merged with the real keys; if it does not parse,
--     the digit keys are dropped.
--
-- Must never fail boot: a value that is not valid JSON is left untouched, and
-- any unexpected error is downgraded to a warning. Idempotent: once unwrapped,
-- nothing matches and every statement is a no-op.

CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(t text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$fn$;

DO $$
DECLARE
  target record;
  rec record;
  changed int;
  pass int;
  rebuilt jsonb;
  ctx jsonb;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('friction_alerts', 'data_context'),
      ('friction_rules', 'config'),
      ('playbooks', 'success_metrics'),
      ('session_anti_pattern_matches', 'details'),
      ('session_patterns', 'data_context'),
      ('team_skill_gaps', 'data_context'),
      ('team_skills', 'generation_context'),
      ('ai_insights', 'data_context'),
      ('ai_reports', 'data_context'),
      ('anti_patterns', 'data_context'),
      ('coaching_cards', 'recommendations'),
      ('ai_messages', 'tool_calls'),
      ('ai_messages', 'tool_results')
    ) AS v(tbl, col)
  LOOP
    CONTINUE WHEN to_regclass(target.tbl) IS NULL;
    FOR pass IN 1..5 LOOP
      EXECUTE format(
        'UPDATE %1$I SET %2$I = pg_temp.try_jsonb(%2$I #>> ''{}'')
          WHERE jsonb_typeof(%2$I) = ''string''
            AND pg_temp.try_jsonb(%2$I #>> ''{}'') IS NOT NULL',
        target.tbl, target.col);
      GET DIAGNOSTICS changed = ROW_COUNT;
      EXIT WHEN changed = 0;
    END LOOP;
  END LOOP;

  -- team_skills.generation_context exploded into per-character keys.
  IF to_regclass('team_skills') IS NOT NULL THEN
    FOR rec IN
      SELECT id, generation_context AS gc FROM team_skills
       WHERE jsonb_typeof(generation_context) = 'object'
         AND generation_context ? '0'
    LOOP
      ctx := rec.gc;
      -- Repeated refinement nests the explosion; peel one layer per pass.
      FOR pass IN 1..5 LOOP
        EXIT WHEN jsonb_typeof(ctx) <> 'object' OR NOT ctx ? '0';
        rebuilt := pg_temp.try_jsonb((
          SELECT string_agg(value #>> '{}', '' ORDER BY key::int)
            FROM jsonb_each(ctx) WHERE key ~ '^\d+$'));
        ctx := COALESCE(
                 (SELECT jsonb_object_agg(key, value) FROM jsonb_each(ctx) WHERE key !~ '^\d+$'),
                 '{}'::jsonb);
        IF jsonb_typeof(rebuilt) = 'string' THEN
          rebuilt := pg_temp.try_jsonb(rebuilt #>> '{}');
        END IF;
        IF jsonb_typeof(rebuilt) = 'object' THEN
          -- Keys set later (refinement_reason, refined_at) win over the original.
          ctx := rebuilt || ctx;
        END IF;
      END LOOP;
      UPDATE team_skills SET generation_context = ctx WHERE id = rec.id;
    END LOOP;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING '[044] jsonb unwrap skipped: %', SQLERRM;
END
$$;
