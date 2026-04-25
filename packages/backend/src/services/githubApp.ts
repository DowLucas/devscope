/**
 * GitHub App client service.
 *
 * Three responsibilities:
 *   1. Sign App-level JWTs (RS256, 10-min TTL, in-memory cached).
 *   2. Exchange the App JWT for an installation access token, with a DB-backed
 *      cache (encrypted at rest by the query module) that survives restarts.
 *   3. Hand out throttled `Octokit` instances authenticated with that
 *      installation token, cached per installation for the token lifetime.
 *
 * Note: we deliberately do NOT use `@octokit/auth-app` for the install-token
 * exchange — keeping it as an explicit `fetch` makes the DB cache the single
 * source of truth and is easier to stub in tests.
 */

import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import jwt from "jsonwebtoken";
import type { SQL } from "bun";

import {
  getInstallationToken as getInstallationTokenRow,
  upsertInstallationToken,
} from "../db/repoInstallationQueries";

// ---------------------------------------------------------------------------
// Config / env
// ---------------------------------------------------------------------------

const JWT_TTL_SECONDS = 10 * 60; // GitHub max
const JWT_REFRESH_BUFFER_MS = 30_000; // re-sign 30s before expiry
const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh install token <60s before expiry

function readAppId(): string {
  const v = process.env.GITHUB_APP_ID;
  if (!v) throw new Error("GITHUB_APP_ID is not set; cannot sign GitHub App JWT");
  return v;
}

function readPrivateKeyPem(): string {
  const b64 = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!b64) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is not set; cannot sign GitHub App JWT (expected base64-encoded PEM)"
    );
  }
  // PEM may be passed plain or base64-encoded. Detect by the presence of the
  // PEM header — if absent, decode base64 first.
  if (b64.includes("-----BEGIN")) return b64;
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch (err) {
    throw new Error(
      `GITHUB_APP_PRIVATE_KEY could not be base64-decoded: ${(err as Error).message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GithubInstallationUnavailableError extends Error {
  readonly status: number;
  readonly installationId: number;
  constructor(installationId: number, status: number, message: string) {
    super(
      `GitHub installation ${installationId} is unavailable (HTTP ${status}): ${message}. ` +
        `The App may be suspended or uninstalled.`
    );
    this.name = "GithubInstallationUnavailableError";
    this.status = status;
    this.installationId = installationId;
  }
}

// ---------------------------------------------------------------------------
// JWT cache
// ---------------------------------------------------------------------------

interface JwtCacheEntry {
  token: string;
  /** ms epoch when the JWT actually expires. */
  expiresAt: number;
}

let jwtCache: JwtCacheEntry | null = null;

/**
 * Sign a GitHub App JWT (RS256, 10-min TTL). Returns the cached value if it
 * still has more than ~30s of life left, otherwise re-signs.
 */
export function signAppJwt(): string {
  const now = Date.now();
  if (jwtCache && jwtCache.expiresAt - now > JWT_REFRESH_BUFFER_MS) {
    return jwtCache.token;
  }

  const appId = readAppId();
  const privateKey = readPrivateKeyPem();
  const iat = Math.floor(now / 1000);
  const exp = iat + JWT_TTL_SECONDS;

  const token = jwt.sign({ iat, exp, iss: appId }, privateKey, { algorithm: "RS256" });
  jwtCache = { token, expiresAt: exp * 1000 };
  return token;
}

/** Test-only: drop the cached JWT so the next call re-signs. */
export function _resetJwtCacheForTests(): void {
  jwtCache = null;
}

// ---------------------------------------------------------------------------
// Installation token (DB-backed cache + GitHub fallback)
// ---------------------------------------------------------------------------

interface AccessTokenResponse {
  token: string;
  expires_at: string; // ISO timestamp
}

/**
 * Returns a plaintext installation access token for the given installation.
 * Checks the DB cache first; falls back to the GitHub API and persists.
 */
export async function getInstallationToken(
  sql: SQL,
  installationId: number,
  // Injectable for tests.
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const existing = await getInstallationTokenRow(sql, installationId);
  if (existing) {
    const expiresMs = new Date(existing.expiresAt).getTime();
    if (expiresMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return existing.token;
    }
  }

  const appJwt = signAppJwt();
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const body = await res.text().catch(() => "");
    throw new GithubInstallationUnavailableError(installationId, res.status, body);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to mint installation token for ${installationId}: HTTP ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as AccessTokenResponse;
  if (!data?.token || !data?.expires_at) {
    throw new Error(
      `Malformed access_tokens response for installation ${installationId}: ${JSON.stringify(data)}`
    );
  }

  await upsertInstallationToken(sql, installationId, data.token, data.expires_at);
  // Invalidate Octokit cache: the underlying token changed.
  octokitCache.delete(installationId);
  return data.token;
}

// ---------------------------------------------------------------------------
// Octokit cache
// ---------------------------------------------------------------------------

const ThrottledOctokit = Octokit.plugin(throttling);

interface OctokitCacheEntry {
  octokit: Octokit;
  /** ms epoch — aligned to the install token expiry. */
  expiresAt: number;
}

const octokitCache = new Map<number, OctokitCacheEntry>();

/**
 * Returns an `Octokit` authenticated with the installation token. Cached per
 * installation for the token lifetime; rebuilt on cache miss or expiry.
 */
export async function octokitForInstallation(
  sql: SQL,
  installationId: number,
  fetchImpl: typeof fetch = fetch
): Promise<Octokit> {
  const cached = octokitCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return cached.octokit;
  }

  const token = await getInstallationToken(sql, installationId, fetchImpl);
  // Re-read the row to align cache TTL to whatever we just persisted (or the
  // existing valid row, if `getInstallationToken` returned a cache hit).
  const row = await getInstallationTokenRow(sql, installationId);
  const expiresAt = row ? new Date(row.expiresAt).getTime() : Date.now() + 55 * 60 * 1000;

  const octokit = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        // Retry once on primary rate-limit.
        return retryCount < 1;
      },
      onSecondaryRateLimit: (retryAfter, options) => {
        // Log only — never auto-retry secondary limits.
        console.warn(
          `[githubApp] secondary rate limit hit on ${options.method} ${options.url}; not retrying`
        );
        return false;
      },
    },
  });

  octokitCache.set(installationId, { octokit, expiresAt });
  return octokit;
}

/** Test-only: drop the Octokit cache. */
export function _resetOctokitCacheForTests(): void {
  octokitCache.clear();
}
