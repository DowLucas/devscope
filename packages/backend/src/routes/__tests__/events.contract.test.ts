/**
 * Plugin↔backend wire-contract test (DEV-88, gap #4 from DEV-84 brief).
 *
 * Loads each fixture from the side-by-side plugin checkout
 * (`devscope-plugin/tests/smoke/fixtures/*.json`), transforms it to the
 * camelCase wire-shape DevscopeEvent the plugin's hook scripts emit, and
 * validates against the strict per-EventType discriminator schema in
 * `../../utils/eventSchemas`.
 *
 * Coverage:
 *   - 7 valid fixtures parse cleanly (the EventTypes the plugin currently
 *     emits via smoke). Backend strict policy: any unknown payload key, any
 *     missing required field, or any unknown eventType is rejected.
 *   - 1 deliberately malformed payload per shape (e.g. session.start missing
 *     `startType`, prompt.submit with wrong-typed `promptLength`) is rejected.
 *   - The discriminated union also rejects an unknown `eventType` value.
 *
 * Plugin-side smoke (`devscope-plugin/tests/smoke/run.sh`) intentionally
 * remains lenient — cross-repo enforcement is a follow-up.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  payloadSchemasByEventType,
  strictEventSchema,
  type EventTypeKey,
} from "../../utils/eventSchemas";

// ---------------------------------------------------------------------------
// Fixture discovery (cross-repo, side-by-side checkout)
// ---------------------------------------------------------------------------

/**
 * Walk up from this test file looking for the side-by-side `devscope-plugin/`
 * checkout. The CI lane on the plugin side already cross-checks out the
 * server, so the inverse is fine for local + CI.
 */
function locatePluginFixturesDir(): string | null {
  let dir = dirname(import.meta.path);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "devscope-plugin", "tests", "smoke", "fixtures");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const fixturesDir = locatePluginFixturesDir();

function readFixture(file: string): Record<string, unknown> {
  if (!fixturesDir) {
    throw new Error(
      `devscope-plugin fixtures not found via side-by-side checkout (looked from ${import.meta.path})`,
    );
  }
  return JSON.parse(readFileSync(resolve(fixturesDir, file), "utf-8"));
}

// ---------------------------------------------------------------------------
// Plugin-script transformation mirrors
// ---------------------------------------------------------------------------
//
// Each helper mirrors the relevant `devscope-plugin/scripts/*.sh` to produce
// the wire-shape camelCase payload the backend actually receives. Kept inline
// (not shared with production code) so a drift in the plugin's transform
// surfaces as a contract-test diff rather than silently aligning.

function envelope(eventType: EventTypeKey, payload: Record<string, unknown>) {
  return {
    id: "evt-contract-test",
    timestamp: "2026-05-08T12:00:00Z",
    sessionId: "smoke-session-0001",
    developerId: "abc123def456",
    developerName: "Contract Tester",
    developerEmail: "qa@example.com",
    projectPath: "/tmp/smoke-project",
    projectName: "smoke-project",
    eventType,
    payload,
  };
}

function transformSessionStart(raw: Record<string, unknown>) {
  // Mirrors scripts/session-start.sh under DEVSCOPE_PRIVACY=standard, no git.
  const payload: Record<string, unknown> = {
    startType: (raw.source as string) ?? "startup",
    permissionMode: (raw.permission_mode as string) ?? "default",
    continued: false,
    claudeSessionId: (raw.session_id as string) ?? "",
    privacyMode: "standard",
  };
  if (raw.model) payload.model = raw.model;
  return envelope("session.start", payload);
}

function transformSessionEnd(raw: Record<string, unknown>) {
  // Mirrors scripts/session-end.sh — endReason from `reason`, no git/files.
  return envelope("session.end", {
    endReason: (raw.reason as string) ?? "other",
  });
}

function transformPromptSubmit(raw: Record<string, unknown>) {
  // Mirrors scripts/prompt-submit.sh under DEVSCOPE_PRIVACY=standard.
  const prompt = (raw.prompt as string) ?? "";
  return envelope("prompt.submit", {
    promptLength: prompt.length,
    isContinuation: Boolean(raw.is_continuation),
    promptText: prompt,
  });
}

function transformToolUse(raw: Record<string, unknown>) {
  // Mirrors scripts/tool-use.sh under DEVSCOPE_PRIVACY=standard.
  const payload: Record<string, unknown> = {
    toolName: (raw.tool_name as string) ?? "unknown",
  };
  if (raw.tool_input != null) payload.toolInput = raw.tool_input;
  return envelope("tool.start", payload);
}

function transformToolComplete(raw: Record<string, unknown>) {
  // Mirrors scripts/tool-complete.sh under DEVSCOPE_PRIVACY=standard.
  const payload: Record<string, unknown> = {
    toolName: (raw.tool_name as string) ?? "unknown",
    success: true,
    duration: 0,
    isInterrupt: Boolean(raw.is_interrupt),
  };
  if (raw.tool_input != null) payload.toolInput = raw.tool_input;
  if (raw.tool_result != null) payload.toolResult = raw.tool_result;
  return envelope("tool.complete", payload);
}

function transformResponseStop(raw: Record<string, unknown>) {
  // Mirrors scripts/response-stop.sh under DEVSCOPE_PRIVACY=standard
  // (no responseText in standard mode; only included under `open`).
  const msg = (raw.last_assistant_message as string) ?? "";
  return envelope("response.complete", {
    responseLength: msg.length,
  });
}

function transformNotification(raw: Record<string, unknown>) {
  // Mirrors scripts/notification.sh.
  return envelope("notification", {
    notificationType: (raw.notification_type as string) ?? "info",
    title: (raw.title as string) ?? "",
    message: ((raw.message as string) ?? "").slice(0, 100),
  });
}

// ---------------------------------------------------------------------------
// Plugin 0.15.0 transforms
// ---------------------------------------------------------------------------

/**
 * Mirrors the block in `scripts/send-event.sh` that forwards the base
 * hook-input fields Claude Code stamps on every event. Each is added only when
 * present on the hook input, so these spread into every 0.15.0 payload below.
 */
function baseFields(raw: Record<string, unknown>) {
  const effort = raw.effort as { level?: string } | undefined;
  return {
    ...(raw.prompt_id ? { promptId: raw.prompt_id as string } : {}),
    ...(raw.permission_mode ? { permissionMode: raw.permission_mode as string } : {}),
    ...(effort?.level ? { effortLevel: effort.level } : {}),
  };
}

function transformToolBatch(raw: Record<string, unknown>) {
  // Mirrors scripts/tool-batch.sh.
  const calls = (raw.tool_calls as Array<Record<string, unknown>>) ?? [];
  return envelope("tool.batch", {
    batchSize: calls.length,
    toolNames: calls.map((c) => c.tool_name as string).filter(Boolean),
    ...baseFields(raw),
  });
}

function transformPromptExpansion(raw: Record<string, unknown>) {
  // Mirrors scripts/prompt-expansion.sh.
  return envelope("prompt.expansion", {
    expansionType: (raw.expansion_type as string) ?? "",
    commandName: (raw.command_name as string) ?? "",
    commandSource: (raw.command_source as string) ?? "",
    argsLength: ((raw.command_args as string) ?? "").length,
    ...baseFields(raw),
  });
}

function transformResponseFailed(raw: Record<string, unknown>) {
  // Mirrors scripts/response-failed.sh.
  const details = (raw.error_details as string) ?? "";
  return envelope("response.failed", {
    error: String(raw.error ?? "").slice(0, 300),
    ...(details ? { errorDetails: details.slice(0, 500) } : {}),
    ...baseFields(raw),
  });
}

function transformModelSwitch(raw: Record<string, unknown>) {
  // Mirrors scripts/model-switch.sh.
  const requested = (raw.requested_model as string) ?? "";
  return envelope("model.switch", {
    fromModel: (raw.from_model as string) ?? "",
    toModel: (raw.to_model as string) ?? "",
    source: (raw.source as string) ?? "",
    contextTokens: (raw.context_tokens as number) ?? 0,
    promptCacheWarm: (raw.prompt_cache_warm as boolean) ?? false,
    ...(requested ? { requestedModel: requested } : {}),
    ...baseFields(raw),
  });
}

function transformPermissionDenied(raw: Record<string, unknown>) {
  // Mirrors scripts/permission-denied.sh. `toolSubcommand` comes from
  // _ds_extract_subcommand; the Bash fixture yields the leading argv token.
  const input = (raw.tool_input as Record<string, unknown>) ?? {};
  const command = (input.command as string) ?? "";
  const sub = command ? command.trim().split(/\s+/)[0] : "";
  return envelope("permission.denied", {
    toolName: (raw.tool_name as string) ?? "",
    toolUseId: (raw.tool_use_id as string) ?? "",
    reason: ((raw.reason as string) ?? "").slice(0, 300),
    ...(sub ? { toolSubcommand: sub } : {}),
    ...baseFields(raw),
  });
}

function transformTaskCreated(raw: Record<string, unknown>) {
  // Mirrors scripts/task-created.sh.
  return envelope("task.created", {
    taskId: (raw.task_id as string) ?? "",
    taskSubject: (raw.task_subject as string) ?? "",
    taskDescription: (raw.task_description as string) ?? "",
    teammateName: (raw.teammate_name as string) ?? "",
    ...baseFields(raw),
  });
}

function transformCwdChanged(raw: Record<string, unknown>) {
  // Mirrors scripts/cwd-changed.sh (standard mode — no path hashing).
  return envelope("cwd.change", {
    oldCwd: (raw.old_cwd as string) ?? "",
    newCwd: (raw.new_cwd as string) ?? "",
    ...baseFields(raw),
  });
}

function transformDirectoryAdded(raw: Record<string, unknown>) {
  // Mirrors scripts/directory-added.sh (standard mode — no path hashing).
  return envelope("directory.added", {
    directory: (raw.directory as string) ?? "",
    source: (raw.source as string) ?? "",
    ...baseFields(raw),
  });
}

function transformPluginSetup(raw: Record<string, unknown>) {
  // Mirrors scripts/setup-hook.sh.
  return envelope("plugin.setup", {
    trigger: (raw.trigger as string) ?? "",
    ...baseFields(raw),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin↔backend wire contract (DEV-88)", () => {
  test("fixture directory is reachable via side-by-side checkout", () => {
    expect(fixturesDir).not.toBeNull();
  });

  // Each entry: [fixture file, plugin transform mirror, expected EventType].
  const fixtureCases: Array<{
    file: string;
    transform: (raw: Record<string, unknown>) => ReturnType<typeof envelope>;
    eventType: EventTypeKey;
  }> = [
    { file: "session-start.json", transform: transformSessionStart, eventType: "session.start" },
    { file: "session-end.json", transform: transformSessionEnd, eventType: "session.end" },
    { file: "prompt-submit.json", transform: transformPromptSubmit, eventType: "prompt.submit" },
    { file: "tool-use.json", transform: transformToolUse, eventType: "tool.start" },
    { file: "tool-complete.json", transform: transformToolComplete, eventType: "tool.complete" },
    { file: "response-stop.json", transform: transformResponseStop, eventType: "response.complete" },
    { file: "notification.json", transform: transformNotification, eventType: "notification" },
    // Added in plugin 0.15.0.
    { file: "tool-batch.json", transform: transformToolBatch, eventType: "tool.batch" },
    { file: "prompt-expansion.json", transform: transformPromptExpansion, eventType: "prompt.expansion" },
    { file: "response-failed.json", transform: transformResponseFailed, eventType: "response.failed" },
    { file: "model-switch.json", transform: transformModelSwitch, eventType: "model.switch" },
    { file: "permission-denied.json", transform: transformPermissionDenied, eventType: "permission.denied" },
    { file: "task-created.json", transform: transformTaskCreated, eventType: "task.created" },
    { file: "cwd-changed.json", transform: transformCwdChanged, eventType: "cwd.change" },
    { file: "directory-added.json", transform: transformDirectoryAdded, eventType: "directory.added" },
    { file: "setup-hook.json", transform: transformPluginSetup, eventType: "plugin.setup" },
  ];

  for (const { file, transform, eventType } of fixtureCases) {
    test(`${file} → ${eventType} parses against strict schema`, () => {
      const raw = readFixture(file);
      const event = transform(raw);
      const result = strictEventSchema.safeParse(event);
      if (!result.success) {
        // Surface useful diff for debugging when a fixture/schema drifts.
        // eslint-disable-next-line no-console
        console.error(`[contract] ${file} failed:`, result.error.issues);
      }
      expect(result.success).toBe(true);
      expect(result.data?.eventType).toBe(eventType);
    });
  }

  test("every EventType in shared has a payload schema", () => {
    // Snapshot the keys so adding a new EventType without a schema fails CI.
    const known = Object.keys(payloadSchemasByEventType).sort();
    expect(known).toEqual(
      [
        "agent.start",
        "agent.stop",
        "compact.complete",
        "compact.pending",
        "config.change",
        "elicitation.request",
        "elicitation.response",
        "instructions.loaded",
        "notification",
        "permission.request",
        "prompt.submit",
        "response.complete",
        "session.end",
        "session.start",
        "task.completed",
        "teammate.idle",
        "tool.complete",
        "tool.fail",
        "tool.start",
        "worktree.create",
        "worktree.remove",
        // Added in plugin 0.15.0.
        "tool.batch",
        "prompt.expansion",
        "response.failed",
        "model.switch",
        "permission.denied",
        "task.created",
        "cwd.change",
        "directory.added",
        "plugin.setup",
      ].sort(),
    );
  });

  // -------------------------------------------------------------------------
  // Negative cases: deliberately malformed payloads must fail
  // -------------------------------------------------------------------------

  test("session.start missing startType is rejected", () => {
    const broken = envelope("session.start", {
      // startType intentionally omitted
      permissionMode: "default",
      continued: false,
      privacyMode: "standard",
    });
    const result = strictEventSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  test("prompt.submit with wrong-typed promptLength is rejected", () => {
    const broken = envelope("prompt.submit", {
      promptLength: "not-a-number",
      isContinuation: false,
    });
    const result = strictEventSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  test("strict mode rejects unknown payload keys", () => {
    const broken = envelope("notification", {
      notificationType: "info",
      title: "hi",
      message: "ok",
      // Unknown extra key — strict() must reject so wire drift surfaces.
      definitelyNotInWireContract: true,
    });
    const result = strictEventSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  test("unknown eventType is rejected", () => {
    const broken = {
      ...envelope("notification", {
        notificationType: "info",
        title: "hi",
        message: "ok",
      }),
      eventType: "session.bogus",
    };
    const result = strictEventSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});
