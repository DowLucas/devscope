// Semantic retrieval API types (GET /api/similar/prompts, GET /api/similar/sessions/:id).
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

// Hybrid keyword + semantic search over turns (GET /api/similar/search).

export type SearchMode = "hybrid" | "keyword" | "semantic";
export type SearchField = "prompt" | "response" | "both";
export type SearchMatch = "keyword" | "semantic";

export interface SearchHit {
  turnId: string;
  sessionId: string;
  /** The turn's prompt.submit event id; deep-links to the turn in the session view. */
  promptEventId: string;
  promptAt: string;
  /** Excerpt with matched terms wrapped in « »; plain opening text when nothing matched. */
  promptSnippet: string;
  responseSnippet: string | null;
  outcome: TurnOutcome;
  sessionTitle: string | null;
  projectName: string;
  /** Which rankings found this turn. */
  matchedBy: SearchMatch[];
  /** Fused reciprocal-rank score; only meaningful for ordering. */
  score: number;
}

export interface SearchResponse {
  mode: SearchMode;
  /** False when embeddings are unavailable and the search ran keyword-only. */
  semanticAvailable: boolean;
  results: SearchHit[];
}
