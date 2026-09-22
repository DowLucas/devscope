// Semantic retrieval API types (GET /api/similar/prompts, GET /api/sessions/:id/similar).
// Results are attributed to sessions and projects only — never to developers.

/** Tool activity between a prompt and the response that closed it. */
export interface TurnOutcome {
  toolCalls: number;
  toolFailures: number;
  toolsUsed: string[];
  durationMs: number | null;
}

export interface SimilarTurn {
  turnId: string;
  sessionId: string;
  promptAt: string;
  /** Up to 4,000 characters. */
  promptText: string;
  /** Up to 4,000 characters; null when the turn ended without a response. */
  responseText: string | null;
  outcome: TurnOutcome;
  sessionTitle: string | null;
  sessionIntent: string | null;
  projectName: string;
  /** Cosine similarity, 1 = identical. */
  similarity: number;
}

export interface SimilarSession {
  sessionId: string;
  sessionTitle: string | null;
  sessionIntent: string | null;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  estimatedCostUsd: number;
  turnCount: number;
  toolCalls: number;
  toolFailures: number;
  similarity: number;
}
