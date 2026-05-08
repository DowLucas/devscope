/**
 * Per-EventType payload schemas — wire-contract enforcement at the boundary.
 *
 * The /api/events route currently accepts `payload: z.record(z.unknown())`,
 * meaning the 18 payload variants in `@devscope/shared` are unenforced past
 * the envelope. This module defines a strict, per-`EventType` discriminator
 * union the route can plug in to reject unknown variants and unknown keys.
 *
 * Policy (DEV-88, CTO-approved):
 *   - Backend is **strict**: unknown EventType values, unknown payload keys,
 *     and missing required fields all fail validation.
 *   - Plugin remains lenient (logs and sends anyway; cross-repo enforcement
 *     is a follow-up).
 *
 * Wire-shape notes (intentional drift the schema must accept):
 *   - `tool.complete` carries `toolResult` on the wire, even though the
 *     `ToolEventPayload` TS type does not list it (see
 *     `devscope-plugin/scripts/tool-complete.sh`). Adding it to the schema
 *     documents reality and is not a wire-contract change.
 *   - `salt_version` may be appended by `send-event.sh` in private mode
 *     for any event type. Schemas accept it as an optional number alongside
 *     the typed fields.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const tokenUsageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheCreationTokens: z.number(),
    cacheReadTokens: z.number(),
  })
  .strict();

const claudeMdFileSchema = z
  .object({
    path: z.string(),
    hash: z.string(),
    size: z.number(),
    content: z.string().optional(),
  })
  .strict();

const instructionsFileSchema = z
  .object({
    path: z.string(),
    hash: z.string(),
    size: z.number(),
    content: z.string().optional(),
    type: z.enum(["claude_md", "rule"]),
  })
  .strict();

/** `salt_version` may be tacked onto any payload by send-event.sh (private mode). */
const privacyAnnotations = {
  salt_version: z.number().optional(),
} as const;

// ---------------------------------------------------------------------------
// Per-event payload schemas
// ---------------------------------------------------------------------------

const sessionStartPayloadSchema = z
  .object({
    startType: z.string(),
    permissionMode: z.string(),
    privacyMode: z.string().optional(),
    continued: z.boolean().optional(),
    claudeSessionId: z.string().optional(),
    model: z.string().optional(),
    gitBranch: z.string().optional(),
    gitCommit: z.string().optional(),
    gitRemoteUrl: z.string().optional(),
    claudeMdFiles: z.array(claudeMdFileSchema).optional(),
    ...privacyAnnotations,
  })
  .strict();

const sessionEndPayloadSchema = z
  .object({
    endReason: z.string(),
    duration: z.number().optional(),
    filesChanged: z.array(z.string()).optional(),
    gitBranch: z.string().optional(),
    gitCommit: z.string().optional(),
    tokenUsage: tokenUsageSchema.optional(),
    ...privacyAnnotations,
  })
  .strict();

const promptSubmitPayloadSchema = z
  .object({
    promptLength: z.number(),
    isContinuation: z.boolean(),
    promptText: z.string().optional(),
    ...privacyAnnotations,
  })
  .strict();

const toolEventPayloadBase = {
  toolName: z.string(),
  toolSubcommand: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
  duration: z.number().optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().optional(),
  isInterrupt: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
  ...privacyAnnotations,
} as const;

const toolStartPayloadSchema = z.object(toolEventPayloadBase).strict();

/**
 * tool.complete additionally carries `toolResult` on the wire — see
 * scripts/tool-complete.sh. Not in the shared TS type, but real on wire.
 */
const toolCompletePayloadSchema = z
  .object({
    ...toolEventPayloadBase,
    toolResult: z.unknown().optional(),
  })
  .strict();

const toolFailPayloadSchema = toolCompletePayloadSchema; // same shape

const agentEventPayloadSchema = z
  .object({
    agentType: z.string(),
    agentId: z.string(),
    parentAgentId: z.string().nullable().optional(),
    ...privacyAnnotations,
  })
  .strict();

const responsePayloadSchema = z
  .object({
    responseLength: z.number().optional(),
    toolsUsed: z.array(z.string()).optional(),
    responseText: z.string().optional(),
    tokenUsage: tokenUsageSchema.optional(),
    ...privacyAnnotations,
  })
  .strict();

const notificationPayloadSchema = z
  .object({
    notificationType: z.string(),
    title: z.string(),
    message: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const preCompactPayloadSchema = z
  .object({
    trigger: z.string(),
    hasCustomInstructions: z.boolean().optional(),
    ...privacyAnnotations,
  })
  .strict();

const taskCompletedPayloadSchema = z
  .object({
    taskId: z.string(),
    taskSubject: z.string(),
    taskDescription: z.string(),
    teammateName: z.string(),
    teamName: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const permissionRequestPayloadSchema = z
  .object({
    toolName: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const worktreeCreatePayloadSchema = z
  .object({
    worktreeName: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const worktreeRemovePayloadSchema = z
  .object({
    worktreePath: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const configChangePayloadSchema = z
  .object({
    source: z.string(),
    filePath: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const postCompactPayloadSchema = z
  .object({
    summary: z.string().optional(),
    tokensBefore: z.number().optional(),
    tokensAfter: z.number().optional(),
    reductionPercent: z.number().optional(),
    ...privacyAnnotations,
  })
  .strict();

const elicitationPayloadSchema = z
  .object({
    mcpServerName: z.string(),
    message: z.string().optional(),
    ...privacyAnnotations,
  })
  .strict();

const elicitationResultPayloadSchema = z
  .object({
    mcpServerName: z.string(),
    duration: z.number().optional(),
    responded: z.boolean(),
    response: z.string().optional(),
    ...privacyAnnotations,
  })
  .strict();

const instructionsLoadedPayloadSchema = z
  .object({
    files: z.array(instructionsFileSchema),
    trigger: z.string(),
    ...privacyAnnotations,
  })
  .strict();

const teammateIdlePayloadSchema = z
  .object({
    teammateName: z.string(),
    teamName: z.string(),
    agentId: z.string().optional(),
    idleReason: z.string().optional(),
    ...privacyAnnotations,
  })
  .strict();

// ---------------------------------------------------------------------------
// Map keyed by EventType — single lookup point for the route + tests
// ---------------------------------------------------------------------------

export const payloadSchemasByEventType = {
  "session.start": sessionStartPayloadSchema,
  "session.end": sessionEndPayloadSchema,
  "prompt.submit": promptSubmitPayloadSchema,
  "tool.start": toolStartPayloadSchema,
  "tool.complete": toolCompletePayloadSchema,
  "tool.fail": toolFailPayloadSchema,
  "agent.start": agentEventPayloadSchema,
  "agent.stop": agentEventPayloadSchema,
  "response.complete": responsePayloadSchema,
  "notification": notificationPayloadSchema,
  "compact.pending": preCompactPayloadSchema,
  "task.completed": taskCompletedPayloadSchema,
  "permission.request": permissionRequestPayloadSchema,
  "worktree.create": worktreeCreatePayloadSchema,
  "worktree.remove": worktreeRemovePayloadSchema,
  "config.change": configChangePayloadSchema,
  "compact.complete": postCompactPayloadSchema,
  "elicitation.request": elicitationPayloadSchema,
  "elicitation.response": elicitationResultPayloadSchema,
  "instructions.loaded": instructionsLoadedPayloadSchema,
  "teammate.idle": teammateIdlePayloadSchema,
} as const;

export type EventTypeKey = keyof typeof payloadSchemasByEventType;

// ---------------------------------------------------------------------------
// Envelope schema — strict event-level fields + dispatched payload
// ---------------------------------------------------------------------------

const eventEnvelopeBase = z.object({
  id: z.string().min(1).max(200),
  timestamp: z.string().min(1).max(50),
  sessionId: z.string().min(1).max(200),
  developerId: z.string().min(1).max(200),
  developerName: z.string().min(1).max(200),
  developerEmail: z.string().max(500).optional().default(""),
  projectPath: z.string().max(1000),
  projectName: z.string().max(200),
});

/**
 * Discriminated event schema: validates envelope + per-EventType payload.
 *
 * Use this in the route handler in place of `z.record(z.unknown())` to enforce
 * the wire contract at the API boundary.
 */
export const strictEventSchema = eventEnvelopeBase
  .extend({
    eventType: z.enum(
      Object.keys(payloadSchemasByEventType) as [EventTypeKey, ...EventTypeKey[]],
    ),
    payload: z.record(z.unknown()),
  })
  .superRefine((event, ctx) => {
    const schema = payloadSchemasByEventType[event.eventType as EventTypeKey];
    if (!schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventType"],
        message: `Unknown eventType: ${event.eventType}`,
      });
      return;
    }
    const result = schema.safeParse(event.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["payload", ...(issue.path ?? [])],
        });
      }
    }
  });

export type StrictEvent = z.infer<typeof strictEventSchema>;
