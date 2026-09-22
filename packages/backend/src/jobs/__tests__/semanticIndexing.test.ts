import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbStubs } from "../../__test_helpers__/mockStubs";

const pending = [
  { turn_id: "1", kind: "prompt", text: "fix it" },
  { turn_id: "1", kind: "response", text: "done" },
];
const mockBuildTurns = mock(() => Promise.resolve(3));
const mockPending = mock(() => Promise.resolve([] as any[]));
const mockUpsert = mock(() => Promise.resolve());
const mockRefresh = mock(() => Promise.resolve(1));

mock.module("../../db", () =>
  dbStubs({
    buildTurns: mockBuildTurns,
    getPendingEmbeddings: mockPending,
    upsertTurnEmbeddings: mockUpsert,
    refreshSessionEmbeddings: mockRefresh,
  }),
);

const mockEmbed = mock(() => Promise.resolve([[1], [2]] as number[][] | null));
mock.module("../../ai/embeddings", () => ({
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 1024,
  isEmbeddingAvailable: () => true,
  embedQuery: mock(() => Promise.resolve(null)),
  embedDocuments: mockEmbed,
  preparePromptText: (t: string) => `P:${t}`,
  prepareResponseText: (t: string) => `R:${t}`,
  contentHash: (t: string) => `hash(${t})`,
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const { indexOnce } = await import("../semanticIndexing");

beforeEach(() => {
  for (const m of [mockBuildTurns, mockPending, mockUpsert, mockRefresh, mockEmbed]) m.mockClear();
  mockEmbed.mockImplementation(() => Promise.resolve([[1], [2]]));
});

describe("indexOnce", () => {
  test("builds turns, embeds pending texts by kind, refreshes sessions", async () => {
    let calls = 0;
    mockPending.mockImplementation(() => Promise.resolve(calls++ === 0 ? pending : []));
    const stats = await indexOnce({} as any);

    expect(stats).toEqual({ turnsBuilt: 3, embedded: 2, sessionsRefreshed: 1, embedderUnavailable: false });
    expect((mockEmbed.mock.calls[0] as any[])[0]).toEqual(["P:fix it", "R:done"]);
    const rows = (mockUpsert.mock.calls[0] as any[])[2];
    expect(rows).toEqual([
      { turn_id: "1", kind: "prompt", content_hash: "hash(P:fix it)", vector: "[1]" },
      { turn_id: "1", kind: "response", content_hash: "hash(R:done)", vector: "[2]" },
    ]);
  });

  test("stops without writing when the embedder is unavailable", async () => {
    mockPending.mockImplementation(() => Promise.resolve(pending));
    mockEmbed.mockImplementation(() => Promise.resolve(null));
    const stats = await indexOnce({} as any);

    expect(stats.embedderUnavailable).toBe(true);
    expect(stats.embedded).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  test("respects the batch budget", async () => {
    mockPending.mockImplementation(() => Promise.resolve(pending));
    await indexOnce({} as any, { maxBatches: 3 });
    expect(mockEmbed).toHaveBeenCalledTimes(3);
  });
});
