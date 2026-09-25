import { Hono, type Context } from "hono";
import type { SQL } from "bun";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getExportData, getDigests, generateDigest } from "../db";
import { gateSelfDeveloperId } from "../middleware/selfDeveloperGate";
import { getViewerDevIds, redactSessionRow, visibilityForRow } from "../services/visibility";

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

const VALID_EXPORT_TYPES = ["team-activity", "sessions", "activity", "failures", "tools"];

export function exportRoutes(sql: SQL) {
  const app = new Hono();

  /** Validate, gate and load export rows; session rows are redacted per viewer. */
  async function loadExport(c: Context): Promise<{ data: unknown[] } | { response: Response }> {
    const dataType = c.req.param("dataType");
    if (!VALID_EXPORT_TYPES.includes(dataType)) {
      return { response: c.json({ error: `Invalid data type. Must be one of: ${VALID_EXPORT_TYPES.join(", ")}` }, 400) };
    }
    const gate = await gateSelfDeveloperId(c, sql);
    if (!gate.allow) return { response: gate.response };
    const days = clampInt(c.req.query("days"), 30, 365);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const data = await getExportData(sql, dataType, days, gate.developerId, devIds);
    if (dataType !== "sessions") return { data };
    const viewerDevIds = await getViewerDevIds(sql, c);
    return {
      data: (data as Record<string, unknown>[]).map((row) => {
        const { owner_share_details: _consent, ...redacted } = redactSessionRow(row, visibilityForRow(row, viewerDevIds));
        return redacted;
      }),
    };
  }

  app.get("/:dataType/csv", async (c) => {
    const dataType = c.req.param("dataType");
    const result = await loadExport(c);
    if ("response" in result) return result.response;
    const csv = toCsv(result.data as Record<string, unknown>[]);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${dataType}-export.csv"`);
    return c.body(csv);
  });

  app.get("/:dataType/json", async (c) => {
    const dataType = c.req.param("dataType");
    const result = await loadExport(c);
    if ("response" in result) return result.response;
    c.header("Content-Disposition", `attachment; filename="${dataType}-export.json"`);
    return c.json(result.data);
  });

  app.get("/digests", async (c) => {
    const limit = clampInt(c.req.query("limit"), 20, 500);
    const orgId = c.get("orgId" as never) as string | undefined;
    return c.json(await getDigests(sql, limit, orgId));
  });

  app.post("/digests/generate", zValidator("json", digestGenerateSchema), async (c) => {
    const body = c.req.valid("json");
    const periodStart = body.period_start;
    const periodEnd = body.period_end;
    const digestType = body.digest_type;
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const digest = await generateDigest(sql, periodStart, periodEnd, digestType, devIds);
    return c.json(digest, 201);
  });

  return app;
}
