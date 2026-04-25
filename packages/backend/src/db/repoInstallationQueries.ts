import type { SQL } from "bun";
import type {
  ConventionProfile,
  InstallationToken,
  RepoInstallation,
  SuggestionKind,
} from "@devscope/shared";

// ---------------------------------------------------------------------------
// Row shape (snake_case) — what Postgres returns. Private to this module.
// Maps to the canonical `RepoInstallation` from @devscope/shared.
// ---------------------------------------------------------------------------

interface RepoInstallationRow {
  id: string;
  organization_id: string;
  github_install_id: number;
  owner: string;
  repo: string;
  default_branch: string;
  cwd_patterns: string[];
  is_live: boolean;
  auto_open_pr_kinds: string[];
  convention_profile: Record<string, unknown>;
  installed_at: string | Date;
  suspended_at: string | Date | null;
}

interface InstallationTokenRow {
  github_install_id: number;
  /** Plaintext — decrypted at the SQL boundary. */
  token: string;
  expires_at: string | Date;
  refreshed_at: string | Date;
}

function rowToRepoInstallation(row: RepoInstallationRow): RepoInstallation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    githubInstallId: row.github_install_id,
    owner: row.owner,
    repo: row.repo,
    defaultBranch: row.default_branch,
    cwdPatterns: row.cwd_patterns,
    isLive: row.is_live,
    autoOpenPrKinds: row.auto_open_pr_kinds as SuggestionKind[],
    conventionProfile: row.convention_profile as ConventionProfile,
    installedAt: row.installed_at,
    suspendedAt: row.suspended_at,
  };
}

function rowToInstallationToken(row: InstallationTokenRow): InstallationToken {
  return {
    githubInstallId: row.github_install_id,
    token: row.token,
    expiresAt: row.expires_at,
    refreshedAt: row.refreshed_at,
  };
}

// ---------------------------------------------------------------------------
// Insert/update inputs (camelCase, canonical-aligned)
// ---------------------------------------------------------------------------

export interface RepoInstallationInsert {
  id: string;
  organizationId: string;
  githubInstallId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
  cwdPatterns?: string[];
  isLive?: boolean;
  autoOpenPrKinds?: SuggestionKind[];
  conventionProfile?: ConventionProfile;
}

export interface RepoInstallationUpdate {
  defaultBranch?: string;
  cwdPatterns?: string[];
  isLive?: boolean;
  autoOpenPrKinds?: SuggestionKind[];
  conventionProfile?: ConventionProfile;
  suspendedAt?: string | null;
}

// ---------------------------------------------------------------------------
// pgcrypto key handling
// ---------------------------------------------------------------------------

/**
 * Lazily resolve the encryption key. We do not throw at import time so that
 * tests can run without the env var; we throw on first call that needs it.
 *
 * The token column is `text`, so we use ASCII-armored mode of pgp_sym_encrypt
 * (the third arg to pgp_sym_encrypt activates options including `armor=true`
 * via `armor()` wrapping). We wrap with `armor()` / `dearmor()` to keep the
 * encrypted payload as printable ASCII that fits a `text` column without a
 * DDL change.
 */
function getEncryptionKey(): string {
  const key = process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "DEVSCOPE_TOKEN_ENCRYPTION_KEY is not set; cannot encrypt/decrypt installation tokens"
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// repo_installations
// ---------------------------------------------------------------------------

export async function insertRepoInstallation(
  sql: SQL,
  input: RepoInstallationInsert
): Promise<RepoInstallation> {
  const cwdPatterns = input.cwdPatterns ?? [];
  const autoKinds = input.autoOpenPrKinds ?? [];
  const conventionProfile = JSON.stringify(input.conventionProfile ?? {});
  const isLive = input.isLive ?? false;

  const [row] = await sql`
    INSERT INTO repo_installations (
      id, organization_id, github_install_id, owner, repo,
      default_branch, cwd_patterns, is_live, auto_open_pr_kinds, convention_profile
    )
    VALUES (
      ${input.id}, ${input.organizationId}, ${input.githubInstallId},
      ${input.owner}, ${input.repo}, ${input.defaultBranch},
      ${cwdPatterns}, ${isLive}, ${autoKinds}, ${conventionProfile}::jsonb
    )
    RETURNING *`;
  return rowToRepoInstallation(row as RepoInstallationRow);
}

/**
 * Insert-or-update a repo installation keyed on the unique
 * `(github_install_id, owner, repo)` constraint. On conflict the row is
 * refreshed (default branch + onboarding defaults if explicitly provided)
 * and its `suspended_at` cleared so reinstalls re-activate the row.
 *
 * The supplied `id` is only used when inserting a fresh row; conflicts keep
 * the existing primary key so foreign-key references remain stable.
 */
export async function upsertRepoInstallation(
  sql: SQL,
  input: RepoInstallationInsert
): Promise<RepoInstallation> {
  const cwdPatterns = input.cwdPatterns ?? [];
  const autoKinds = input.autoOpenPrKinds ?? [];
  const conventionProfile = JSON.stringify(input.conventionProfile ?? {});
  const isLive = input.isLive ?? false;

  const [row] = await sql`
    INSERT INTO repo_installations (
      id, organization_id, github_install_id, owner, repo,
      default_branch, cwd_patterns, is_live, auto_open_pr_kinds, convention_profile
    )
    VALUES (
      ${input.id}, ${input.organizationId}, ${input.githubInstallId},
      ${input.owner}, ${input.repo}, ${input.defaultBranch},
      ${cwdPatterns}, ${isLive}, ${autoKinds}, ${conventionProfile}::jsonb
    )
    ON CONFLICT (github_install_id, owner, repo) DO UPDATE SET
      default_branch = EXCLUDED.default_branch,
      suspended_at   = NULL
    RETURNING *`;
  return rowToRepoInstallation(row as RepoInstallationRow);
}

export async function getRepoInstallation(
  sql: SQL,
  id: string
): Promise<RepoInstallation | null> {
  const [row] = await sql`SELECT * FROM repo_installations WHERE id = ${id}`;
  return row ? rowToRepoInstallation(row as RepoInstallationRow) : null;
}

export async function getRepoInstallationByGithubId(
  sql: SQL,
  githubInstallId: number,
  owner: string,
  repo: string
): Promise<RepoInstallation | null> {
  const [row] = await sql`
    SELECT * FROM repo_installations
    WHERE github_install_id = ${githubInstallId}
      AND owner = ${owner}
      AND repo = ${repo}`;
  return row ? rowToRepoInstallation(row as RepoInstallationRow) : null;
}

export async function listRepoInstallationsForOrg(
  sql: SQL,
  organizationId: string
): Promise<RepoInstallation[]> {
  const rows = (await sql`
    SELECT * FROM repo_installations
    WHERE organization_id = ${organizationId}
    ORDER BY installed_at DESC`) as RepoInstallationRow[];
  return rows.map(rowToRepoInstallation);
}

export async function updateRepoInstallation(
  sql: SQL,
  id: string,
  updates: RepoInstallationUpdate
): Promise<void> {
  // Single statement: COALESCE keeps the existing column value when the
  // caller didn't provide a new one. jsonb is serialized to text first; the
  // ::jsonb cast handles a literal NULL natively.
  const conventionProfile =
    updates.conventionProfile !== undefined ? JSON.stringify(updates.conventionProfile) : null;
  await sql`
    UPDATE repo_installations SET
      default_branch      = COALESCE(${updates.defaultBranch ?? null}, default_branch),
      cwd_patterns        = COALESCE(${updates.cwdPatterns ?? null}, cwd_patterns),
      is_live             = COALESCE(${updates.isLive ?? null}, is_live),
      auto_open_pr_kinds  = COALESCE(${updates.autoOpenPrKinds ?? null}, auto_open_pr_kinds),
      convention_profile  = COALESCE(${conventionProfile}::jsonb, convention_profile),
      suspended_at        = COALESCE(${updates.suspendedAt ?? null}::timestamptz, suspended_at)
    WHERE id = ${id}`;
}

export async function deleteRepoInstallation(sql: SQL, id: string): Promise<void> {
  await sql`DELETE FROM repo_installations WHERE id = ${id}`;
}

/**
 * Soft-suspend a repo installation. Sets `suspended_at = NOW()` (idempotent —
 * does not overwrite an existing timestamp). Returns the new suspended_at and
 * the install's organization_id, or null if no row matched.
 *
 * We never hard-delete: audit log entries reference repo_installation_id and
 * we want history preserved across reinstalls/uninstalls.
 */
export async function suspendRepoInstallation(
  sql: SQL,
  id: string
): Promise<{ id: string; organizationId: string; suspendedAt: string | Date } | null> {
  const [row] = await sql`
    UPDATE repo_installations
       SET suspended_at = COALESCE(suspended_at, NOW())
     WHERE id = ${id}
    RETURNING id, organization_id, suspended_at`;
  if (!row) return null;
  const r = row as { id: string; organization_id: string; suspended_at: string | Date };
  return { id: r.id, organizationId: r.organization_id, suspendedAt: r.suspended_at };
}

/**
 * Suspend ALL repo_installations rows matching a given github_install_id.
 * Used by the GitHub webhook when an `installation.deleted` event fires —
 * the App was uninstalled at the GitHub side, so every repo we tracked under
 * that install must be marked suspended.
 *
 * Returns the suspended rows (id + organization_id + suspended_at) so the
 * caller can write per-install audit entries. Idempotent via
 * COALESCE(suspended_at, NOW()) — re-running won't overwrite earlier
 * timestamps.
 */
export async function suspendInstallationByGithubId(
  sql: SQL,
  githubInstallId: number
): Promise<Array<{ id: string; organizationId: string; suspendedAt: string | Date }>> {
  const rows = (await sql`
    UPDATE repo_installations
       SET suspended_at = COALESCE(suspended_at, NOW())
     WHERE github_install_id = ${githubInstallId}
    RETURNING id, organization_id, suspended_at`) as Array<{
    id: string;
    organization_id: string;
    suspended_at: string | Date;
  }>;
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    suspendedAt: r.suspended_at,
  }));
}

/**
 * Suspend repo_installations rows matching a given github_install_id and any
 * of the supplied (owner, repo) pairs. Used by the webhook when an
 * `installation_repositories.removed` event fires — the user revoked access
 * to specific repos but kept the installation alive.
 *
 * Returns the suspended rows so the caller can audit-log each one.
 */
export async function suspendRepoInstallationsByGithubIdAndRepos(
  sql: SQL,
  githubInstallId: number,
  repos: Array<{ owner: string; repo: string }>
): Promise<Array<{ id: string; organizationId: string; suspendedAt: string | Date }>> {
  if (repos.length === 0) return [];
  // Bun.sql arrays do not work in IN (...). Build parallel arrays of owners
  // and repos and join on row position via UNNEST — keeps a single
  // parameterized statement.
  const owners = repos.map((r) => r.owner);
  const names = repos.map((r) => r.repo);
  const rows = (await sql`
    UPDATE repo_installations AS ri
       SET suspended_at = COALESCE(ri.suspended_at, NOW())
      FROM UNNEST(${owners}::text[], ${names}::text[]) AS t(owner, repo)
     WHERE ri.github_install_id = ${githubInstallId}
       AND ri.owner = t.owner
       AND ri.repo  = t.repo
    RETURNING ri.id, ri.organization_id, ri.suspended_at`) as Array<{
    id: string;
    organization_id: string;
    suspended_at: string | Date;
  }>;
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    suspendedAt: r.suspended_at,
  }));
}

// ---------------------------------------------------------------------------
// installation_tokens (encrypted at SQL boundary)
// ---------------------------------------------------------------------------

/**
 * Upsert an installation token. The plaintext token never lands in the DB —
 * it is encrypted by `pgp_sym_encrypt` and ASCII-armored so the ciphertext
 * fits the existing `token text` column.
 */
export async function upsertInstallationToken(
  sql: SQL,
  githubInstallId: number,
  token: string,
  expiresAt: string
): Promise<void> {
  const key = getEncryptionKey();
  await sql`
    INSERT INTO installation_tokens (github_install_id, token, expires_at, refreshed_at)
    VALUES (
      ${githubInstallId},
      armor(pgp_sym_encrypt(${token}, ${key})),
      ${expiresAt}::timestamptz,
      NOW()
    )
    ON CONFLICT (github_install_id) DO UPDATE SET
      token = armor(pgp_sym_encrypt(${token}, ${key})),
      expires_at = ${expiresAt}::timestamptz,
      refreshed_at = NOW()`;
}

/**
 * Fetch and decrypt an installation token. Returns null if absent.
 */
export async function getInstallationToken(
  sql: SQL,
  githubInstallId: number
): Promise<InstallationToken | null> {
  const key = getEncryptionKey();
  const [row] = await sql`
    SELECT
      github_install_id,
      pgp_sym_decrypt(dearmor(token), ${key}) AS token,
      expires_at,
      refreshed_at
    FROM installation_tokens
    WHERE github_install_id = ${githubInstallId}`;
  return row ? rowToInstallationToken(row as InstallationTokenRow) : null;
}

export async function deleteInstallationToken(
  sql: SQL,
  githubInstallId: number
): Promise<void> {
  await sql`DELETE FROM installation_tokens WHERE github_install_id = ${githubInstallId}`;
}
