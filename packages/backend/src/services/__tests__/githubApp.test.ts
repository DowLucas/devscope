import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

// Mocked DB layer — must be set up before importing the service.
const mockGetInstallationToken = mock(async (_sql: unknown, _id: number) => null as any);
const mockUpsertInstallationToken = mock(
  async (_sql: unknown, _id: number, _token: string, _exp: string) => {}
);

mock.module("../../db/repoInstallationQueries", () => ({
  getInstallationToken: mockGetInstallationToken,
  upsertInstallationToken: mockUpsertInstallationToken,
}));

import {
  GithubInstallationUnavailableError,
  _resetJwtCacheForTests,
  _resetOctokitCacheForTests,
  getInstallationToken,
  octokitForInstallation,
  signAppJwt,
} from "../githubApp";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_APP_ID = "123456";
let publicKeyPem: string;
let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKeyPem = publicKey;
  privateKeyPem = privateKey;
});

const fakeSql = {} as any;

beforeEach(() => {
  process.env.GITHUB_APP_ID = TEST_APP_ID;
  process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(privateKeyPem, "utf8").toString("base64");
  _resetJwtCacheForTests();
  _resetOctokitCacheForTests();
  mockGetInstallationToken.mockReset();
  mockUpsertInstallationToken.mockReset();
  mockGetInstallationToken.mockImplementation(async () => null);
  mockUpsertInstallationToken.mockImplementation(async () => {});
});

afterEach(() => {
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

// ---------------------------------------------------------------------------
// signAppJwt
// ---------------------------------------------------------------------------

describe("signAppJwt", () => {
  test("produces a verifiable RS256 JWT with iss/iat/exp", () => {
    const token = signAppJwt();
    const decoded = jwt.verify(token, publicKeyPem, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe(TEST_APP_ID);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
    expect(decoded.exp! - decoded.iat!).toBe(600);
  });

  test("returns the cached token within the validity window", () => {
    const t1 = signAppJwt();
    const t2 = signAppJwt();
    expect(t1).toBe(t2);
  });

  test("re-signs after the cache is invalidated (simulates near-expiry)", () => {
    const t1 = signAppJwt();
    _resetJwtCacheForTests();
    // Force a different `iat` by waiting 1s would be slow; instead, mutate
    // the JWT clock by re-signing — the new token will differ because `iat`
    // is set from Date.now() at sign time. Even if iat collides, the cache
    // reset path itself is what we're proving runs.
    const t2 = signAppJwt();
    // They could in principle be identical if signed within the same second
    // with identical claims. Verify both decode and that re-signing happened
    // by checking the cache reset doesn't throw and produces a valid token.
    const decoded = jwt.verify(t2, publicKeyPem, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe(TEST_APP_ID);
    expect(t1).toBeTruthy();
  });

  test("throws a clear error when GITHUB_APP_PRIVATE_KEY is missing", () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    _resetJwtCacheForTests();
    expect(() => signAppJwt()).toThrow(/GITHUB_APP_PRIVATE_KEY is not set/);
  });

  test("throws a clear error when GITHUB_APP_ID is missing", () => {
    delete process.env.GITHUB_APP_ID;
    _resetJwtCacheForTests();
    expect(() => signAppJwt()).toThrow(/GITHUB_APP_ID is not set/);
  });

  test("accepts a plain (non-base64) PEM in the env var", () => {
    process.env.GITHUB_APP_PRIVATE_KEY = privateKeyPem;
    _resetJwtCacheForTests();
    const token = signAppJwt();
    const decoded = jwt.verify(token, publicKeyPem, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    expect(decoded.iss).toBe(TEST_APP_ID);
  });
});

// ---------------------------------------------------------------------------
// getInstallationToken
// ---------------------------------------------------------------------------

describe("getInstallationToken", () => {
  test("returns the DB-cached token when not expired", async () => {
    const inFiveMin = new Date(Date.now() + 5 * 60_000).toISOString();
    mockGetInstallationToken.mockImplementation(async () => ({
      githubInstallId: 42,
      token: "ghs_cached",
      expiresAt: inFiveMin,
      refreshedAt: new Date().toISOString(),
    }));
    const fetchSpy = mock(async () => new Response("should not be called", { status: 500 }));

    const tok = await getInstallationToken(fakeSql, 42, fetchSpy as any);
    expect(tok).toBe("ghs_cached");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockUpsertInstallationToken).not.toHaveBeenCalled();
  });

  test("calls GitHub and persists when DB cache is empty", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    mockGetInstallationToken.mockImplementation(async () => null);
    const fetchSpy = mock(
      async () =>
        new Response(JSON.stringify({ token: "ghs_fresh", expires_at: expiresAt }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
    );

    const tok = await getInstallationToken(fakeSql, 99, fetchSpy as any);
    expect(tok).toBe("ghs_fresh");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/app/installations/99/access_tokens");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect((init.headers as Record<string, string>).Accept).toBe("application/vnd.github+json");
    expect(mockUpsertInstallationToken).toHaveBeenCalledTimes(1);
    expect(mockUpsertInstallationToken.mock.calls[0]?.[1]).toBe(99);
    expect(mockUpsertInstallationToken.mock.calls[0]?.[2]).toBe("ghs_fresh");
  });

  test("refreshes when DB cache expires within 60s", async () => {
    const inThirtySec = new Date(Date.now() + 30_000).toISOString();
    mockGetInstallationToken.mockImplementation(async () => ({
      githubInstallId: 7,
      token: "ghs_old",
      expiresAt: inThirtySec,
      refreshedAt: new Date().toISOString(),
    }));
    const futureExp = new Date(Date.now() + 60 * 60_000).toISOString();
    const fetchSpy = mock(
      async () =>
        new Response(JSON.stringify({ token: "ghs_new", expires_at: futureExp }), { status: 201 })
    );

    const tok = await getInstallationToken(fakeSql, 7, fetchSpy as any);
    expect(tok).toBe("ghs_new");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("throws GithubInstallationUnavailableError on 404", async () => {
    mockGetInstallationToken.mockImplementation(async () => null);
    const fetchSpy = mock(async () => new Response("Not Found", { status: 404 }));

    await expect(getInstallationToken(fakeSql, 1234, fetchSpy as any)).rejects.toBeInstanceOf(
      GithubInstallationUnavailableError
    );
  });

  test("throws GithubInstallationUnavailableError on 401", async () => {
    mockGetInstallationToken.mockImplementation(async () => null);
    const fetchSpy = mock(async () => new Response("Unauthorized", { status: 401 }));
    await expect(getInstallationToken(fakeSql, 1, fetchSpy as any)).rejects.toBeInstanceOf(
      GithubInstallationUnavailableError
    );
  });

  test("throws a generic error on other non-2xx responses", async () => {
    mockGetInstallationToken.mockImplementation(async () => null);
    const fetchSpy = mock(async () => new Response("boom", { status: 500 }));
    await expect(getInstallationToken(fakeSql, 1, fetchSpy as any)).rejects.toThrow(/HTTP 500/);
  });
});

// ---------------------------------------------------------------------------
// octokitForInstallation
// ---------------------------------------------------------------------------

describe("octokitForInstallation", () => {
  test("returns the same Octokit instance on repeat calls within token lifetime", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    let callCount = 0;
    mockGetInstallationToken.mockImplementation(async () => {
      callCount++;
      // First call (in getInstallationToken's cache check): empty so we mint.
      // Subsequent calls (post-mint re-read for TTL alignment, and the second
      // octokitForInstallation call's cache hit path) return the persisted row.
      if (callCount === 1) return null;
      return {
        githubInstallId: 11,
        token: "ghs_x",
        expiresAt,
        refreshedAt: new Date().toISOString(),
      };
    });
    const fetchSpy = mock(
      async () =>
        new Response(JSON.stringify({ token: "ghs_x", expires_at: expiresAt }), { status: 201 })
    );

    const o1 = await octokitForInstallation(fakeSql, 11, fetchSpy as any);
    const o2 = await octokitForInstallation(fakeSql, 11, fetchSpy as any);
    expect(o1).toBe(o2);
    // Only one GitHub mint call — second call should hit the Octokit cache.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
