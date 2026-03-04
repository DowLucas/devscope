import type { SessionTurn } from "@devscope/shared";

interface RawEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function buildTurns(events: RawEvent[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;

  function ensureTurn(): SessionTurn {
    if (!current) {
      current = { toolCalls: [], agents: [] };
      turns.push(current);
    }
    return current;
  }

  for (const event of events) {
    const p = event.payload;

    switch (event.event_type) {
      case "prompt.submit":
        // Start a new turn
        current = {
          prompt: {
            content: (p.promptText as string) || `Prompt (${p.promptLength ?? 0} chars)`,
            timestamp: event.created_at,
          },
          toolCalls: [],
          agents: [],
        };
        turns.push(current);
        break;

      case "tool.start":
      case "tool.complete":
      case "tool.fail": {
        const turn = ensureTurn();
        // For tool.start, add a placeholder; for complete/fail, try to update the last matching entry
        const toolInput = p.toolInput as Record<string, unknown> | undefined;
        if (event.event_type === "tool.start") {
          turn.toolCalls.push({
            toolName: String(p.toolName ?? "Unknown"),
            toolInput,
            timestamp: event.created_at,
          });
        } else {
          // Find matching tool.start to update, or add new
          const existing = turn.toolCalls.findLast(
            (tc) => tc.toolName === String(p.toolName ?? "") && tc.success === undefined
          );
          if (existing) {
            existing.success = event.event_type === "tool.complete";
            existing.duration = p.duration as number | undefined;
            existing.errorMessage = p.errorMessage as string | undefined;
            if (toolInput) existing.toolInput = toolInput;
          } else {
            turn.toolCalls.push({
              toolName: String(p.toolName ?? "Unknown"),
              toolInput,
              success: event.event_type === "tool.complete",
              duration: p.duration as number | undefined,
              errorMessage: p.errorMessage as string | undefined,
              timestamp: event.created_at,
            });
          }
        }
        break;
      }

      case "agent.start":
      case "agent.stop": {
        const turn = ensureTurn();
        turn.agents.push({
          agentType: String(p.agentType ?? "agent"),
          agentId: String(p.agentId ?? ""),
          action: event.event_type === "agent.start" ? "start" : "stop",
          timestamp: event.created_at,
        });
        break;
      }

      case "response.complete": {
        const turn = ensureTurn();
        turn.response = {
          toolsUsed: (p.toolsUsed as string[]) ?? [],
          responseLength: p.responseLength as number | undefined,
          responseText: p.responseText as string | undefined,
          timestamp: event.created_at,
        };
        // Close current turn
        current = null;
        break;
      }

      case "session.start":
      case "session.end":
        // Lifecycle events don't start turns
        break;
    }
  }

  return turns;
}
