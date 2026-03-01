import { Hono } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getExportData, getDigests, generateDigest } from "../db";

const digestGenerateSchema = z.object({
  period_start: z.string().min(1).max(50),
  period_end: z.string().min(1).max(50),
  digest_type: z.string().max(50).default("manual"),
});

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

function toCsv(data: unknown[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0] as Record<string, unknown>);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = (row as Record<string, unknown>)[h];
        const str = val === null || val === undefined ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

const VALID_EXPORT_TYPES = ["leaderboard", "sessions", "activity", "failures", "tools"];

export function exportRoutes(sql: SQL) {
  const app = new Hono();

  app.get("/:dataType/csv", async (c) => {
    const dataType = c.req.param("dataType");
    if (!VALID_EXPORT_TYPES.includes(dataType)) {
      return c.json({ error: `Invalid data type. Must be one of: ${VALID_EXPORT_TYPES.join(", ")}` }, 400);
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    const developerId = c.req.query("developerId") || undefined;
    const data = await getExportData(sql, dataType, days, developerId);
    const csv = toCsv(data as Record<string, unknown>[]);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${dataType}-export.csv"`);
    return c.body(csv);
  });

  app.get("/:dataType/json", async (c) => {
    const dataType = c.req.param("dataType");
    if (!VALID_EXPORT_TYPES.includes(dataType)) {
      return c.json({ error: `Invalid data type. Must be one of: ${VALID_EXPORT_TYPES.join(", ")}` }, 400);
    }
    const days = clampInt(c.req.query("days"), 30, 365);
    const developerId = c.req.query("developerId") || undefined;
    const data = await getExportData(sql, dataType, days, developerId);
    c.header("Content-Disposition", `attachment; filename="${dataType}-export.json"`);
    return c.json(data);
  });

  app.get("/digests", async (c) => {
    const limit = clampInt(c.req.query("limit"), 20, 500);
    return c.json(await getDigests(sql, limit));
  });

  app.post("/digests/generate", zValidator("json", digestGenerateSchema), async (c) => {
    const body = c.req.valid("json");
    const periodStart = body.period_start;
    const periodEnd = body.period_end;
    const digestType = body.digest_type;
    const digest = await generateDigest(sql, periodStart, periodEnd, digestType);
    return c.json(digest, 201);
  });

  return app;
}
