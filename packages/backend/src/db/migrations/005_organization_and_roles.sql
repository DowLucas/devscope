-- better-auth organization plugin tables

CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  logo TEXT,
  metadata TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitation (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'pending',
  "inviterId" TEXT NOT NULL REFERENCES auth_user(id),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add activeOrganizationId to auth_session for better-auth org plugin
DO $$ BEGIN
  ALTER TABLE auth_session ADD COLUMN "activeOrganizationId" TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- DevScope: link dashboard accounts to plugin-tracked developers
CREATE TABLE IF NOT EXISTS user_developer_link (
  auth_user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  developer_id TEXT NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  PRIMARY KEY (auth_user_id, developer_id)
);

-- DevScope: scope plugin data by organization
CREATE TABLE IF NOT EXISTS organization_developer (
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  developer_id TEXT NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, developer_id)
);

-- DevScope: per-org settings
CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  inactive_threshold_days INTEGER NOT NULL DEFAULT 7
);

CREATE INDEX IF NOT EXISTS idx_member_org ON member ("organizationId");
CREATE INDEX IF NOT EXISTS idx_member_user ON member ("userId");
CREATE INDEX IF NOT EXISTS idx_invitation_org ON invitation ("organizationId");
CREATE INDEX IF NOT EXISTS idx_invitation_email ON invitation (email);
CREATE INDEX IF NOT EXISTS idx_org_developer_org ON organization_developer (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_developer_dev ON organization_developer (developer_id);
CREATE INDEX IF NOT EXISTS idx_user_dev_link_dev ON user_developer_link (developer_id);
