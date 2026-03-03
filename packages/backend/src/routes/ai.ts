import type { SQL } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { isAiAvailable } from "../ai/gemini";
import { runQueryWorkflowStreaming } from "../ai/workflows/queryWorkflow";
import { runInsightWorkflow } from "../ai/workflows/insightWorkflow";
import { runReportWorkflow } from "../ai/workflows/reportWorkflow";
import {
  createConversation,
  getConversation,
  getConversations,
  getConversationMessages,
  deleteConversation,
  createMessage,
  updateConversationTitle,
  getInsights,
  getReports,
  getReport,
  getTokenUsageSummary,
  getTodayTokenCount,
} from "../db";
import { broadcast, broadcastToOrg } from "../ws/handler";
import type { Content } from "@google/genai";
import type { InsightType, InsightSeverity, ReportType } from "@devscope/shared";

const AI_DAILY_TOKEN_BUDGET = Number(
  process.env.AI_DAILY_TOKEN_BUDGET ?? 1_000_000
);

// In-memory rate limiter: 20 requests/minute
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export function aiRoutes(sql: SQL) {
  const app = new Hono();

  // Guard middleware for generation endpoints only (POST routes that call Gemini)
  function requireAi() {
    return async (c: any, next: any) => {
      if (!isAiAvailable()) {
        return c.json(
          { error: "AI features unavailable: GEMINI_API_KEY not configured" },
          503
        );
      }
      const session = c.get("session" as never) as any;
      const clientKey = session?.user?.id ?? c.req.header("x-forwarded-for") ?? "default";
      if (!checkRateLimit(clientKey)) {
        return c.json({ error: "Rate limit exceeded. Max 20 AI requests/minute." }, 429);
      }
      const todayTokens = await getTodayTokenCount(sql);
      if (todayTokens >= AI_DAILY_TOKEN_BUDGET) {
        return c.json(
          { error: "Daily AI token budget exceeded. Try again tomorrow." },
          429
        );
      }
      return next();
    };
  }

  // --- Chat ---

  const chatSchema = z.object({
    question: z.string().min(1).max(2000),
    conversation_id: z.string().optional(),
  });

  app.post("/chat", requireAi(), zValidator("json", chatSchema), async (c) => {
    const { question, conversation_id } = c.req.valid("json");
    const orgId = c.get("orgId" as never) as string | undefined;
    const user = c.get("user" as never) as any;
    const userId = user?.id;
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;

    // Get or create conversation
    let conversationId = conversation_id;
    if (conversationId) {
      // Verify the user owns this conversation before appending to it
      const conv = await getConversation(sql, conversationId);
      if (!conv || (conv as any).user_id !== userId) {
        return c.json({ error: "Conversation not found" }, 404);
      }
    } else {
      const conv = await createConversation(
        sql,
        question.slice(0, 100),
        orgId,
        userId
      );
      conversationId = conv.id;
    }

    // Save user message
    await createMessage(sql, conversationId, "user", question);

    // Build conversation history from DB
    const messages = await getConversationMessages(sql, conversationId);
    const history: Content[] = [];
    for (const msg of messages.slice(0, -1)) {
      // Exclude the message we just inserted
      history.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    // Run streaming workflow
    const stream = await runQueryWorkflowStreaming(sql, question, history, devIds);

    // Collect full answer for saving
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullAnswer = "";

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            controller.enqueue(value);

            // Parse SSE to collect answer
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                try {
                  const payload = JSON.parse(line.slice(6));
                  if (payload.type === "text") {
                    fullAnswer += payload.content;
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }
          }

          // Save assistant message
          await createMessage(sql, conversationId!, "assistant", fullAnswer);

          // Auto-title: update conversation title from first question
          if (!conversation_id && question.length > 0) {
            await updateConversationTitle(
              sql,
              conversationId!,
              question.slice(0, 100)
            );
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": conversationId,
      },
    });
  });

  // --- Conversations ---

  app.get("/chat/conversations", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
    const user = c.get("user" as never) as any;
    const userId = user?.id;
    const conversations = await getConversations(sql, limit, userId);
    return c.json(conversations);
  });

  app.get("/chat/conversations/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user" as never) as any;
    const userId = user?.id;

    // Verify the user owns this conversation before returning messages
    const conv = await getConversation(sql, id);
    if (!conv || (conv as any).user_id !== userId) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const messages = await getConversationMessages(sql, id);
    return c.json(messages);
  });

  app.delete("/chat/conversations/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user" as never) as any;
    const userId = user?.id;
    await deleteConversation(sql, id, userId);
    return c.json({ ok: true });
  });

  // --- Insights ---

  app.get("/insights", async (c) => {
    const type = c.req.query("type") as InsightType | undefined;
    const severity = c.req.query("severity") as InsightSeverity | undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const orgId = c.get("orgId" as never) as string | undefined;
    const insights = await getInsights(sql, { type, severity, limit, orgId });
    return c.json(insights);
  });

  app.post("/insights/generate", requireAi(), async (c) => {
    const days = Math.min(Number(c.req.query("days") ?? 1), 30);
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;
    const orgId = c.get("orgId" as never) as string | undefined;
    const insights = await runInsightWorkflow(sql, days, devIds);

    // Broadcast new insights via WebSocket
    for (const insight of insights) {
      if (orgId) {
        broadcastToOrg(orgId, { type: "ai.insight.new", data: insight });
      } else {
        broadcast({ type: "ai.insight.new", data: insight });
      }
    }

    return c.json(insights);
  });

  // --- Reports ---

  app.get("/reports", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
    const orgId = c.get("orgId" as never) as string | undefined;
    const reports = await getReports(sql, limit, orgId);
    return c.json(reports);
  });

  app.get("/reports/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId" as never) as string | undefined;
    const report = await getReport(sql, id, orgId);
    if (!report) return c.json({ error: "Report not found" }, 404);
    return c.json(report);
  });

  const reportSchema = z.object({
    report_type: z.enum(["daily", "weekly", "custom"]),
    title: z.string().optional(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    persona: z.enum(["manager", "cto", "ceo"]).optional(),
  });

  app.post("/reports/generate", requireAi(), zValidator("json", reportSchema), async (c) => {
    const { report_type, title, period_start, period_end, persona } =
      c.req.valid("json");
    const orgId = c.get("orgId" as never) as string | undefined;
    const devIds = c.get("orgDeveloperIds" as never) as string[] | undefined;

    // Run async — respond immediately with report ID
    const report = await runReportWorkflow(
      sql,
      report_type as ReportType,
      title,
      period_start,
      period_end,
      persona,
      devIds
    );

    if (orgId) {
      broadcastToOrg(orgId, { type: "ai.report.completed", data: report });
    } else {
      broadcast({ type: "ai.report.completed", data: report });
    }

    return c.json(report);
  });

  // --- Token Usage ---

  app.get("/usage", async (c) => {
    const days = Math.min(Number(c.req.query("days") ?? 30), 365);
    const usage = await getTokenUsageSummary(sql, days);
    return c.json({
      ...usage,
      daily_budget: AI_DAILY_TOKEN_BUDGET,
      today_used: await getTodayTokenCount(sql),
    });
  });

  return app;
}
