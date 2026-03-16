import { Hono } from "hono";
import type { SQL } from "bun";
import {
  getMarketplacePlaybooks,
  getMarketplacePlaybook,
  publishToMarketplace,
  adoptMarketplacePlaybook,
  rateMarketplacePlaybook,
} from "../db";
import { logEthicsEvent } from "../utils/ethicsAudit";

function clampInt(val: string | undefined, def: number, max: number): number {
  if (!val) return def;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : def;
}

export function marketplaceRoutes(sql: SQL) {
  const app = new Hono();

  // GET /api/marketplace/playbooks — browse published playbooks
  app.get("/playbooks", async (c) => {
    const category = c.req.query("category") || undefined;
    const limit = clampInt(c.req.query("limit"), 50, 200);
    const offset = clampInt(c.req.query("offset"), 0, 10000);
    const playbooks = await getMarketplacePlaybooks(sql, { category, limit, offset });
    return c.json(playbooks);
  });

  // GET /api/marketplace/playbooks/:id — single playbook detail
  app.get("/playbooks/:id", async (c) => {
    const id = c.req.param("id");
    const playbook = await getMarketplacePlaybook(sql, id);
    if (!playbook) return c.json({ error: "Not found" }, 404);
    return c.json(playbook);
  });

  // POST /api/marketplace/playbooks — publish a playbook to marketplace
  app.post("/playbooks", async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    const body = await c.req.json();

    const { source_playbook_id, name, description, tool_sequence, when_to_use, success_metrics, category, tags, anonymous } = body;

    if (!name || !description || !tool_sequence || !Array.isArray(tool_sequence)) {
      return c.json({ error: "name, description, and tool_sequence are required" }, 400);
    }

    // Validate tool sequence format
    const toolRegex = /^[a-zA-Z0-9_\-:.]+$/;
    for (const tool of tool_sequence) {
      if (typeof tool !== "string" || !toolRegex.test(tool)) {
        return c.json({ error: `Invalid tool name: ${tool}` }, 400);
      }
    }

    const published = await publishToMarketplace(
      sql,
      source_playbook_id ?? null,
      anonymous ? null : (orgId ?? null),
      {
        name,
        description,
        tool_sequence,
        when_to_use: when_to_use ?? "",
        success_metrics: success_metrics ?? {},
        category,
        tags,
      }
    );

    if (orgId) {
      logEthicsEvent(sql, orgId, "data_request_processed", {
        action: "marketplace_publish",
        playbook_id: published.id,
        anonymous: !!anonymous,
      });
    }

    return c.json(published, 201);
  });

  // POST /api/marketplace/playbooks/:id/adopt — adopt a playbook
  app.post("/playbooks/:id/adopt", async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const id = c.req.param("id");
    const playbook = await getMarketplacePlaybook(sql, id);
    if (!playbook || playbook.status !== "published") {
      return c.json({ error: "Playbook not found or not published" }, 404);
    }

    const adoption = await adoptMarketplacePlaybook(sql, id, orgId);

    // Create a local playbook copy
    const localId = crypto.randomUUID();
    await sql`
      INSERT INTO playbooks (id, name, description, tool_sequence, when_to_use, success_metrics, status, created_by)
      VALUES (${localId}, ${playbook.name}, ${playbook.description}, ${playbook.tool_sequence},
              ${playbook.when_to_use}, ${JSON.stringify(playbook.success_metrics)}, 'active', 'marketplace')`;

    return c.json({ adoption, local_playbook_id: localId }, 201);
  });

  // POST /api/marketplace/playbooks/:id/rate — rate an adopted playbook
  app.post("/playbooks/:id/rate", async (c) => {
    const orgId = c.get("orgId" as never) as string | undefined;
    if (!orgId) return c.json({ error: "No active organization" }, 400);

    const id = c.req.param("id");
    const body = await c.req.json();
    const rating = body.rating;

    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return c.json({ error: "Rating must be 1-5" }, 400);
    }

    await rateMarketplacePlaybook(sql, id, orgId, rating);
    return c.json({ ok: true });
  });

  return app;
}
