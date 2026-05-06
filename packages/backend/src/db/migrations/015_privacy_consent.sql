-- Data export/deletion requests from developers
CREATE TABLE IF NOT EXISTS data_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  developer_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'deletion')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  handled_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_requests_org
  ON data_requests(organization_id, status);
