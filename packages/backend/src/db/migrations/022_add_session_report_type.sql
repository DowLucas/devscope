-- Add 'session' to ai_reports report_type check constraint
ALTER TABLE ai_reports DROP CONSTRAINT ai_reports_report_type_check;
ALTER TABLE ai_reports ADD CONSTRAINT ai_reports_report_type_check
  CHECK (report_type IN ('daily', 'weekly', 'custom', 'session'));
