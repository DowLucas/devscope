import type { SQL } from "bun";

// ---------------------------------------------------------------------------
// Inline minimal types. Task 1.4 will add canonical versions to @devscope/shared
// at which point these can be replaced by imports without changing call sites.
// ---------------------------------------------------------------------------

export type RepoInstallation = {
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
  installed_at: string;
  suspended_at: string | null;
};

export type RepoInstallationInsert = {
  id: string;
  organization_id: string;
  github_install_id: number;
  owner: string;
  repo: string;
  default_branch: string;
  cwd_patterns?: string[];
  is_live?: boolean;
  auto_open_pr_kinds?: string[];
  convention_profile?: Record<string, unknown>;
};

export type InstallationToken = {
  github_install_id: number;
  /** Plaintext — decrypted at the SQL boundary. */
  token: string;
  expires_at: string;
  refreshed_at: string;
};

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
  const cwdPatterns = input.cwd_patterns ?? [];
  const autoKinds = input.auto_open_pr_kinds ?? [];
  const conventionProfile = JSON.stringify(input.convention_profile ?? {});
  const isLive = input.is_live ?? false;

  await sql`
    INSERT INTO repo_installations (
      id, organization_id, github_install_id, owner, repo,
      default_branch, cwd_patterns, is_live, auto_open_pr_kinds, convention_profile
    )
    VALUES (
      ${input.id}, ${input.organization_id}, ${input.github_install_id},
      ${input.owner}, ${input.repo}, ${input.default_branch},
      ${cwdPatterns}, ${isLive}, ${autoKinds}, ${conventionProfile}::jsonb
    )`;

  const [row] = await sql`SELECT * FROM repo_installations WHERE id = ${input.id}`;
  return row as RepoInstallation;
}

export async function getRepoInstallation(
  sql: SQL,
  id: string
): Promise<RepoInstallation | null> {
  const [row] = await sql`SELECT * FROM repo_installations WHERE id = ${id}`;
  return (row as RepoInstallation) ?? null;
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
  return (row as RepoInstallation) ?? null;
}

export async function listRepoInstallationsForOrg(
  sql: SQL,
  organizationId: string
): Promise<RepoInstallation[]> {
  return (await sql`
    SELECT * FROM repo_installations
    WHERE organization_id = ${organizationId}
    ORDER BY installed_at DESC`) as RepoInstallation[];
}

export async function updateRepoInstallation(
  sql: SQL,
  id: string,
  updates: Partial<{
    default_branch: string;
    cwd_patterns: string[];
    is_live: boolean;
    auto_open_pr_kinds: string[];
    convention_profile: Record<string, unknown>;
    suspended_at: string | null;
  }>
): Promise<void> {
  if (updates.default_branch !== undefined) {
    await sql`UPDATE repo_installations SET default_branch = ${updates.default_branch} WHERE id = ${id}`;
  }
  if (updates.cwd_patterns !== undefined) {
    await sql`UPDATE repo_installations SET cwd_patterns = ${updates.cwd_patterns} WHERE id = ${id}`;
  }
  if (updates.is_live !== undefined) {
    await sql`UPDATE repo_installations SET is_live = ${updates.is_live} WHERE id = ${id}`;
  }
  if (updates.auto_open_pr_kinds !== undefined) {
    await sql`UPDATE repo_installations SET auto_open_pr_kinds = ${updates.auto_open_pr_kinds} WHERE id = ${id}`;
  }
  if (updates.convention_profile !== undefined) {
    const cp = JSON.stringify(updates.convention_profile);
    await sql`UPDATE repo_installations SET convention_profile = ${cp}::jsonb WHERE id = ${id}`;
  }
  if (updates.suspended_at !== undefined) {
    await sql`UPDATE repo_installations SET suspended_at = ${updates.suspended_at} WHERE id = ${id}`;
  }
}

export async function deleteRepoInstallation(sql: SQL, id: string): Promise<void> {
  await sql`DELETE FROM repo_installations WHERE id = ${id}`;
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
  return (row as InstallationToken) ?? null;
}

export async function deleteInstallationToken(
  sql: SQL,
  githubInstallId: number
): Promise<void> {
  await sql`DELETE FROM installation_tokens WHERE github_install_id = ${githubInstallId}`;
}
