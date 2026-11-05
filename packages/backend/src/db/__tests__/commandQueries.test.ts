/**
 * Bash command timing (migration 058, commandQueries.ts).
 *
 * `cleanSignature` is pure and always runs. The rest is gated on
 * TEST_DATABASE_URL, like tokenUsage.test.ts:
 *
 *   TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
 *     bun test packages/backend/src/db/__tests__/commandQueries.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DevscopeEvent } from "@devscope/shared";
import { initializeDatabase } from "../schema";
import {
  cleanSignature,
  getCommandProjects,
  getCommandSummary,
  getCommandTrend,
  recordCommandRun,
  settleBackgroundCommands,
} from "../commandQueries";

describe("cleanSignature", () => {
  test("keeps signatures the plugin produces", () => {
    expect(cleanSignature("bun run build")).toBe("bun run build");
    expect(cleanSignature("npm run test:unit")).toBe("npm run test:unit");
    expect(cleanSignature("Docker  Compose up")).toBe("docker compose up");
    expect(cleanSignature("deploy.sh")).toBe("deploy.sh");
  });

  test("reduces anything else to its program, never command text", () => {
    expect(cleanSignature("rm -rf /home/someone/secret")).toBe("rm");
    expect(cleanSignature("git commit -m hello world")).toBe("git");
    expect(cleanSignature("a b c d")).toBe("a");
    expect(cleanSignature("/usr/bin/env")).toBe("usrbinenv");
    expect(cleanSignature("   ")).toBeNull();
    expect(cleanSignature(42)).toBeNull();
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d("command_runs — ingestion, background settling, reads", () => {
  let sqlPromise: ReturnType<typeof initializeDatabase> | null = null;
  const getSql = () => (sqlPromise ??= initializeDatabase(dbUrl!));

  const run = crypto.randomUUID().slice(0, 8);
  const devA = `t-cmd-a-${run}`; // the viewer
  const devB = `t-cmd-b-${run}`; // teammate, does not share
  const devC = `t-cmd-c-${run}`; // teammate, shares
  const sA = `t-cmd-sa-${run}`;
  const sB = `t-cmd-sb-${run}`;
  const sC = `t-cmd-sc-${run}`;
  const sP = `t-cmd-sp-${run}`; // devA, private
  const projX = `proj-x-${run}`;
  const projSecret = `proj-secret-${run}`;
  const all = [devA, devB, devC];

  let n = 0;
  async function bash(
    sessionId: string,
    payload: Record<string, unknown>,
    opts: { eventType?: "tool.complete" | "tool.fail"; at?: Date } = {},
  ) {
    const sql = await getSql();
    const id = `t-cmd-ev-${run}-${++n}`;
    const at = (opts.at ?? new Date()).toISOString();
    const eventType = opts.eventType ?? "tool.complete";
    await sql`INSERT INTO events (id, session_id, event_type, payload, created_at)
      VALUES (${id}, ${sessionId}, ${eventType}, ${{ toolName: "Bash", ...payload }}::jsonb, ${at}::timestamptz)`;
    await recordCommandRun(sql, {
      id, sessionId, eventType, timestamp: at, payload: { toolName: "Bash", ...payload },
      developerId: "", developerName: "", projectPath: "", projectName: "",
    } as unknown as DevscopeEvent);
    return id;
  }
  async function row(toolUseId: string) {
    const sql = await getSql();
    const [r] = await sql`SELECT * FROM command_runs WHERE tool_use_id = ${toolUseId}`;
    return r as any;
  }
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  const tid = (name: string) => `toolu_${name}_${run}`;

  beforeAll(async () => {
    const sql = await getSql();
    for (const [dev, share] of [[devA, false], [devB, false], [devC, true]] as const) {
      await sql`INSERT INTO developers (id, name, email, share_details) VALUES (${dev}, ${dev}, ${dev + "@t"}, ${share})`;
    }
    for (const [id, dev, project, privacy] of [
      [sA, devA, projX, "standard"],
      [sB, devB, projSecret, "standard"],
      [sC, devC, projX, "standard"],
      [sP, devA, "redacted", "private"],
    ] as const) {
      await sql`INSERT INTO sessions (id, developer_id, project_path, project_name, privacy_mode)
        VALUES (${id}, ${dev}, ${"/p/" + project}, ${project}, ${privacy})`;
    }
  });

  afterAll(async () => {
    const sql = await getSql();
    const sessions = [sA, sB, sC, sP];
    for (const s of sessions) {
      await sql`DELETE FROM command_runs WHERE session_id = ${s}`;
      await sql`DELETE FROM events WHERE session_id = ${s}`;
      await sql`DELETE FROM sessions WHERE id = ${s}`;
    }
    for (const dev of all) await sql`DELETE FROM developers WHERE id = ${dev}`;
  });

  test("a foreground command: started duration_ms before the event, settled", async () => {
    await bash(sA, { duration: 10_000, toolUseId: tid("fg"), commandSignature: "bun test" }, { at: daysAgo(1) });
    const r = await row(tid("fg"));
    expect([r.signature, r.program, r.mode, r.outcome, r.wait_ms, r.duration_ms, r.legacy_timing])
      .toEqual(["bun test", "bun", "foreground", "success", 10_000, 10_000, false]);
    expect(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()).toBe(10_000);
  });

  test("failures, interrupts, subagents", async () => {
    await bash(sA, { duration: 500, toolUseId: tid("fail"), commandSignature: "bun test" }, { eventType: "tool.fail" });
    await bash(sA, { duration: 50, toolUseId: tid("intr"), commandSignature: "bun test", isInterrupt: true }, { eventType: "tool.fail" });
    await bash(sA, { duration: 50, toolUseId: tid("sub"), commandSignature: "ls", agentId: "agent-1" });
    expect((await row(tid("fail"))).outcome).toBe("failure");
    expect((await row(tid("intr"))).outcome).toBe("interrupted");
    expect((await row(tid("sub"))).in_subagent).toBe(true);
  });

  test("older plugins: keyed by event id, signature from toolSubcommand, legacy timing", async () => {
    const id = await bash(sA, { duration: 300, toolSubcommand: "cargo" });
    const r = await row(`event:${id}`);
    expect([r.signature, r.legacy_timing]).toEqual(["cargo", true]);
  });

  test("command text never reaches the signature; private sessions keep the program", async () => {
    await bash(sA, { duration: 1, toolUseId: tid("junk"), commandSignature: "curl -H 'x-api-key: secret' http://x" });
    await bash(sP, { duration: 1, toolUseId: tid("priv"), commandSignature: "docker compose up" });
    expect((await row(tid("junk"))).signature).toBe("curl");
    expect((await row(tid("priv"))).signature).toBe("docker");
  });

  test("recording is idempotent per tool_use_id, and ignores other tools", async () => {
    await bash(sA, { duration: 999, toolUseId: tid("fg"), commandSignature: "bun test" });
    expect((await row(tid("fg"))).wait_ms).toBe(10_000);
    const sql = await getSql();
    await recordCommandRun(sql, {
      id: "x", sessionId: sA, eventType: "tool.complete", timestamp: new Date().toISOString(),
      payload: { toolName: "Read", toolUseId: tid("read") },
    } as unknown as DevscopeEvent);
    expect(await row(tid("read"))).toBeUndefined();
  });

  test("background: running until settled, only by its own developer, once", async () => {
    const at = new Date(Date.now() - 60_000);
    await bash(sA, { duration: 20, toolUseId: tid("bg"), commandSignature: "bun run dev", backgroundTaskId: "b1", runInBackground: true }, { at });
    await bash(sA, { duration: 120_000, toolUseId: tid("moved"), commandSignature: "bun test", backgroundTaskId: "b2" }, { at });
    let r = await row(tid("bg"));
    expect([r.mode, r.outcome, r.wait_ms, r.duration_ms, r.finished_at]).toEqual(["background", "running", 20, null, null]);
    expect((await row(tid("moved"))).mode).toBe("moved");

    const sql = await getSql();
    const finishedAt = new Date(at.getTime() + 45_000).toISOString();
    expect(await settleBackgroundCommands(sql, devB, [{ toolUseId: tid("bg"), status: "completed", exitCode: 0, finishedAt }])).toBe(0);
    expect(await settleBackgroundCommands(sql, devA, [
      { toolUseId: tid("bg"), status: "completed", exitCode: 0, finishedAt },
      { toolUseId: tid("moved"), status: "failed", exitCode: 1, finishedAt },
      { toolUseId: tid("unknown"), status: "completed", finishedAt },
    ])).toBe(2);
    r = await row(tid("bg"));
    expect([r.outcome, r.exit_code, r.duration_ms]).toEqual(["success", 0, 45_020]);
    expect([(await row(tid("moved"))).outcome, (await row(tid("moved"))).exit_code]).toEqual(["failure", 1]);
    expect(await settleBackgroundCommands(sql, devA, [{ toolUseId: tid("bg"), status: "killed", finishedAt }])).toBe(0);
  });

  test("the row goes with its event (retention)", async () => {
    const id = await bash(sA, { duration: 5, toolUseId: tid("gone"), commandSignature: "ls" });
    const sql = await getSql();
    await sql`DELETE FROM events WHERE id = ${id}`;
    expect(await row(tid("gone"))).toBeUndefined();
  });

  describe("reads", () => {
    beforeAll(async () => {
      await bash(sC, { duration: 30_000, toolUseId: tid("c1"), commandSignature: "bun test" });
      await bash(sB, { duration: 90_000, toolUseId: tid("b1"), commandSignature: "make deploy" });
      await bash(sB, { duration: 80_000, toolUseId: tid("b2"), commandSignature: "make deploy" });
      // The period before (days 30-60) for comparison, and out of range.
      await bash(sA, { duration: 4_000, toolUseId: tid("old"), commandSignature: "bun test" }, { at: daysAgo(40) });
      await bash(sA, { duration: 4_000, toolUseId: tid("ancient"), commandSignature: "bun test" }, { at: daysAgo(90) });
    });
    const scope = (over: Partial<Parameters<typeof getCommandSummary>[1]> = {}) =>
      ({ devIds: all, viewerDevIds: [devA], days: 30, project: null, ...over });

    test("summary: by time waited, a hidden teammate's runs only under their program", async () => {
      const sql = await getSql();
      const s = await getCommandSummary(sql, scope(), "signature");
      const by = Object.fromEntries(s.commands.map((c) => [c.command, c]));
      expect(Object.keys(by)).not.toContain("make deploy");
      expect(by.make.runs).toBe(2);
      expect(by.make.wait_ms).toBe(170_000);
      expect(s.commands[0]!.command).toBe("make");
      const bunTest = by["bun test"]!;
      // fg 10s, fail 0.5s, interrupt 0.05s, moved 120s (settled as failed above),
      // teammate C's 30s (shared)
      expect([bunTest.runs, bunTest.failures, bunTest.interrupted, bunTest.moved_runs]).toEqual([5, 2, 1, 1]);
      expect(bunTest.prev_runs).toBe(1);
      expect(bunTest.max_ms).toBeGreaterThanOrEqual(120_000);
      expect(by["bun run dev"]!.background_runs).toBe(1);
      expect(s.totals.prev_runs).toBe(1);
      expect(s.totals.runs).toBe(s.commands.reduce((a, c) => a + c.runs, 0));
      // Totals cover every command, also those cut off by `limit`.
      const cut = await getCommandSummary(sql, scope(), "signature", 1);
      expect(cut.commands.length).toBe(1);
      expect([cut.totals.runs, cut.totals.failures, cut.totals.moved_runs])
        .toEqual([s.totals.runs, s.commands.reduce((a, c) => a + c.failures, 0), 1]);
    });

    test("the teammate sees their own signature", async () => {
      const sql = await getSql();
      const s = await getCommandSummary(sql, scope({ viewerDevIds: [devB] }), "signature");
      expect(s.commands.map((c) => c.command)).toContain("make deploy");
    });

    test("a project filter matches only sessions the viewer may see", async () => {
      const sql = await getSql();
      const secret = await getCommandSummary(sql, scope({ project: projSecret }), "signature");
      expect(secret.commands).toEqual([]);
      const x = await getCommandSummary(sql, scope({ project: projX }), "signature");
      expect(x.commands.find((c) => c.command === "bun test")!.runs).toBe(5);
      expect(x.commands.map((c) => c.command)).not.toContain("make");
    });

    test("group by program; scope me", async () => {
      const sql = await getSql();
      const prog = await getCommandSummary(sql, scope(), "program");
      expect(prog.commands.find((c) => c.command === "bun")!.runs).toBe(6); // 5 bun test + bun run dev
      const me = await getCommandSummary(sql, scope({ devIds: [devA] }), "signature");
      expect(me.commands.find((c) => c.command === "bun test")!.runs).toBe(4);
      expect(me.commands.map((c) => c.command)).not.toContain("make");
    });

    test("trend: one point per day, filtered by command", async () => {
      const sql = await getSql();
      const t = await getCommandTrend(sql, scope(), "signature", "bun test", "day");
      expect(t.points.length).toBeGreaterThanOrEqual(30);
      expect(t.points.reduce((a, p) => a + p.runs, 0)).toBe(5);
      expect(t.points.at(-1)!.bucket).toBe(new Date().toISOString().slice(0, 10));
      const weeks = await getCommandTrend(sql, scope(), "signature", null, "week");
      expect(weeks.points.length).toBeLessThanOrEqual(6);
    });

    test("projects: only the ones the viewer may see", async () => {
      const sql = await getSql();
      const p = (await getCommandProjects(sql, scope())).map((r) => r.project);
      expect(p).toContain(projX);
      expect(p).not.toContain(projSecret);
      expect(p).not.toContain("redacted");
    });

    test("no developers: empty, without a query", async () => {
      const sql = await getSql();
      expect((await getCommandSummary(sql, scope({ devIds: [] }), "signature")).commands).toEqual([]);
      expect((await getCommandTrend(sql, scope({ devIds: [] }), "signature", null, "day")).points).toEqual([]);
    });
  });
});
