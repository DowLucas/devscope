/**
 * Strips opt-in sensitive fields (promptText, toolInput, responseText) from event payloads.
 *
 * These fields are only sent when a developer opts in via DEVSCOPE_SHARE_DETAILS.
 * Even when stored, they should only be visible to the developer themselves —
 * not to other team members viewing the dashboard.
 *
 * Team members see: tool name, success/fail, duration, prompt length.
 * The developer sees: all of the above + their own prompt text and tool inputs.
 */
export function stripSensitivePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...payload };
  delete stripped.promptText;
  delete stripped.toolInput;
  delete stripped.responseText;
  return stripped;
}

/**
 * Strips sensitive fields from a full event object (as returned by API).
 */
export function stripSensitiveEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (!event.payload || typeof event.payload !== "object") return event;
  return {
    ...event,
    payload: stripSensitivePayload(event.payload as Record<string, unknown>),
  };
}
