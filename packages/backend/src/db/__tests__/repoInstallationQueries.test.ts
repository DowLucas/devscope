import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  insertRepoInstallation,
  getRepoInstallation,
  listRepoInstallationsForOrg,
  upsertInstallationToken,
  getInstallationToken,
  deleteInstallationToken,
} from "../repoInstallationQueries";

// ---------------------------------------------------------------------------
// Tagged-template SQL mock: captures every call, can be programmed with rows.
// ---------------------------------------------------------------------------

type Call = { query: string; values: unknown[] };

function makeSql(rowsByMatch: Array<{ match: RegExp; rows: unknown[] }> = []) {
  const calls: Call[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const hit = rowsByMatch.find(r => r.match.test(query));
    return Promise.resolve(hit ? hit.rows : []);
  }) as any;
  fn.calls = calls;
  return fn;
}

const ORIGINAL_KEY = process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY = "test-key-base64";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

// ---------------------------------------------------------------------------
// repo_installations CRUD
// ---------------------------------------------------------------------------

describe("repo_installations queries", () => {
  test("insertRepoInstallation inserts with defaults and returns canonical (camelCase) row from RETURNING *", async () => {
    // Postgres returns snake_case; the mapper converts to canonical camelCase.
    const dbRow = {
      id: "ri-1",
      organization_id: "org-1",
      github_install_id: 42,
      owner: "acme",
      repo: "widgets",
      default_branch: "main",
      cwd_patterns: [],
      is_live: false,
      auto_open_pr_kinds: [],
      convention_profile: {},
      installed_at: "2026-04-25T00:00:00Z",
      suspended_at: null,
    };
    const sql = makeSql([{ match: /INSERT INTO repo_installations/, rows: [dbRow] }]);

    const row = await insertRepoInstallation(sql, {
      id: "ri-1",
      organizationId: "org-1",
      githubInstallId: 42,
      owner: "acme",
      repo: "widgets",
      defaultBranch: "main",
    });

    expect(row.id).toBe("ri-1");
    expect(row.organizationId).toBe("org-1");
    expect(row.githubInstallId).toBe(42);
    expect(row.defaultBranch).toBe("main");
    expect(sql.calls).toHaveLength(1); // single round-trip via RETURNING *
    const insertCall = sql.calls[0];
    expect(insertCall.query).toMatch(/RETURNING \*/);
    expect(insertCall.values).toContain("ri-1");
    expect(insertCall.values).toContain("org-1");
    expect(insertCall.values).toContain(42);
  });

  test("getRepoInstallation returns null when no row", async () => {
    const sql = makeSql();
    const row = await getRepoInstallation(sql, "missing");
    expect(row).toBeNull();
  });

  test("suspendRepoInstallation issues UPDATE with COALESCE(suspended_at, NOW()) and returns canonical row", async () => {
    const dbRow = {
      id: "ri-9",
      organization_id: "org-1",
      suspended_at: "2026-04-25T10:00:00Z",
    };
    const { suspendRepoInstallation } = await import("../repoInstallationQueries");
    const sql = makeSql([{ match: /UPDATE repo_installations/, rows: [dbRow] }]);

    const result = await suspendRepoInstallation(sql, "ri-9");
    expect(result).toEqual({
      id: "ri-9",
      organizationId: "org-1",
      suspendedAt: "2026-04-25T10:00:00Z",
    });
    const call = sql.calls[0];
    expect(call.query).toMatch(/UPDATE repo_installations/);
    expect(call.query).toContain("COALESCE(suspended_at, NOW())");
    expect(call.query).toMatch(/RETURNING id, organization_id, suspended_at/);
    expect(call.values).toContain("ri-9");
  });

  test("suspendRepoInstallation returns null when no row matched", async () => {
    const { suspendRepoInstallation } = await import("../repoInstallationQueries");
    const sql = makeSql();
    const result = await suspendRepoInstallation(sql, "missing");
    expect(result).toBeNull();
  });

  test("suspendInstallationByGithubId updates all matching rows and returns canonical mapping", async () => {
    const { suspendInstallationByGithubId } = await import("../repoInstallationQueries");
    const sql = makeSql([
      {
        match: /UPDATE repo_installations\s+SET suspended_at/,
        rows: [
          { id: "ri-1", organization_id: "org-1", suspended_at: "2026-04-25T10:00:00Z" },
          { id: "ri-2", organization_id: "org-1", suspended_at: "2026-04-25T10:00:00Z" },
        ],
      },
    ]);
    const rows = await suspendInstallationByGithubId(sql, 123);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "ri-1",
      organizationId: "org-1",
      suspendedAt: "2026-04-25T10:00:00Z",
    });
    const call = sql.calls[0];
    expect(call.query).toContain("WHERE github_install_id");
    expect(call.query).toContain("COALESCE(suspended_at, NOW())");
    expect(call.values).toContain(123);
  });

  test("suspendInstallationByGithubId returns [] when nothing matched", async () => {
    const { suspendInstallationByGithubId } = await import("../repoInstallationQueries");
    const sql = makeSql();
    const rows = await suspendInstallationByGithubId(sql, 999);
    expect(rows).toEqual([]);
  });

  test("suspendRepoInstallationsByGithubIdAndRepos short-circuits on empty repo list", async () => {
    const { suspendRepoInstallationsByGithubIdAndRepos } = await import(
      "../repoInstallationQueries"
    );
    const sql = makeSql();
    const rows = await suspendRepoInstallationsByGithubIdAndRepos(sql, 42, []);
    expect(rows).toEqual([]);
    expect(sql.calls).toHaveLength(0);
  });

  test("suspendRepoInstallationsByGithubIdAndRepos passes parallel owner/repo arrays via UNNEST", async () => {
    const { suspendRepoInstallationsByGithubIdAndRepos } = await import(
      "../repoInstallationQueries"
    );
    const sql = makeSql([
      {
        match: /UNNEST/,
        rows: [{ id: "ri-1", organization_id: "org-1", suspended_at: "2026-04-25T10:00:00Z" }],
      },
    ]);
    const rows = await suspendRepoInstallationsByGithubIdAndRepos(sql, 42, [
      { owner: "acme", repo: "widgets" },
      { owner: "acme", repo: "gadgets" },
    ]);
    expect(rows).toHaveLength(1);
    const call = sql.calls[0];
    expect(call.query).toContain("UNNEST");
    expect(call.values).toContain(42);
    // owners + names arrays bound as parameters
    expect(call.values.some((v: unknown) => Array.isArray(v) && v.includes("acme"))).toBe(true);
    expect(call.values.some((v: unknown) => Array.isArray(v) && v.includes("widgets"))).toBe(true);
  });

  test("listRepoInstallationsForOrg filters by organization_id and maps every row", async () => {
    const baseRow = {
      organization_id: "org-1",
      github_install_id: 1,
      owner: "a",
      repo: "b",
      default_branch: "main",
      cwd_patterns: [],
      is_live: false,
      auto_open_pr_kinds: [],
      convention_profile: {},
      installed_at: "2026-04-25T00:00:00Z",
      suspended_at: null,
    };
    const sql = makeSql([
      {
        match: /WHERE organization_id/,
        rows: [
          { ...baseRow, id: "ri-1" },
          { ...baseRow, id: "ri-2" },
        ],
      },
    ]);
    const rows = await listRepoInstallationsForOrg(sql, "org-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("ri-1");
    expect(rows[1].id).toBe("ri-2");
    expect(sql.calls[0].values).toContain("org-1");
  });
});

// ---------------------------------------------------------------------------
// installation_tokens — encryption at SQL boundary
// ---------------------------------------------------------------------------

describe("installation_tokens (encryption)", () => {
  test("upsertInstallationToken SQL contains pgp_sym_encrypt and armor", async () => {
    const sql = makeSql();
    await upsertInstallationToken(sql, 123, "ghs_secrettoken", "2030-01-01T00:00:00Z");
    const insertCall = sql.calls[0];
    expect(insertCall.query).toContain("pgp_sym_encrypt");
    expect(insertCall.query).toContain("armor(");
    expect(insertCall.query).toContain("ON CONFLICT");
    // plaintext token is bound as a parameter (the tagged-template captures it)
    expect(insertCall.values).toContain("ghs_secrettoken");
    expect(insertCall.values).toContain("test-key-base64");
  });

  test("getInstallationToken SQL contains pgp_sym_decrypt and dearmor and returns canonical shape", async () => {
    const sql = makeSql([
      {
        match: /pgp_sym_decrypt/,
        rows: [
          {
            github_install_id: 123,
            token: "plaintext",
            expires_at: "2030-01-01T00:00:00Z",
            refreshed_at: "2026-04-01T00:00:00Z",
          },
        ],
      },
    ]);
    const row = await getInstallationToken(sql, 123);
    expect(row?.token).toBe("plaintext"); // caller sees plaintext
    expect(row?.githubInstallId).toBe(123); // canonical camelCase
    const selectCall = sql.calls[0];
    expect(selectCall.query).toContain("pgp_sym_decrypt");
    expect(selectCall.query).toContain("dearmor(");
    expect(selectCall.values).toContain("test-key-base64");
  });

  test("getInstallationToken returns null when no row", async () => {
    const sql = makeSql();
    const row = await getInstallationToken(sql, 999);
    expect(row).toBeNull();
  });

  test("throws clearly when encryption key env var missing", async () => {
    delete process.env.DEVSCOPE_TOKEN_ENCRYPTION_KEY;
    const sql = makeSql();
    await expect(
      upsertInstallationToken(sql, 1, "tok", "2030-01-01T00:00:00Z")
    ).rejects.toThrow(/DEVSCOPE_TOKEN_ENCRYPTION_KEY/);
  });

  test("deleteInstallationToken issues DELETE with id parameter", async () => {
    const sql = makeSql();
    await deleteInstallationToken(sql, 7);
    expect(sql.calls[0].query).toMatch(/DELETE FROM installation_tokens/);
    expect(sql.calls[0].values).toContain(7);
  });
});
