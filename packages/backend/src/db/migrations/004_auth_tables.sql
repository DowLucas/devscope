-- better-auth core tables (custom names to avoid PostgreSQL reserved words)

CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_account (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  "idToken" TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- better-auth API key plugin table
CREATE TABLE IF NOT EXISTS apikey (
  id TEXT PRIMARY KEY,
  "configId" TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  start TEXT,
  "referenceId" TEXT NOT NULL,
  prefix TEXT,
  key TEXT NOT NULL,
  "refillInterval" INTEGER,
  "refillAmount" INTEGER,
  "lastRefillAt" TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT TRUE,
  "rateLimitEnabled" BOOLEAN DEFAULT TRUE,
  "rateLimitTimeWindow" INTEGER DEFAULT 86400000,
  "rateLimitMax" INTEGER DEFAULT 10,
  "requestCount" INTEGER DEFAULT 0,
  remaining INTEGER,
  "lastRequest" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  permissions TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_apikey_key ON apikey (key);
CREATE INDEX IF NOT EXISTS idx_apikey_reference_id ON apikey ("referenceId");
CREATE INDEX IF NOT EXISTS idx_apikey_config_id ON apikey ("configId");
