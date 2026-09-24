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
const mockRecordFailure = mock(() => Promise.resolve());
const mockPendingErrors = mock(() => Promise.resolve([] as any[]));
const mockUpsertErrors = mock(() => Promise.resolve());
const mockRecordErrorFailure = mock(() => Promise.resolve());
let lockAvailable = true;
const mockLock = mock((_sql: unknown, fn: () => Promise<unknown>) => (lockAvailable ? fn() : Promise.resolve(null)));

mock.module("../../db", () =>
  dbStubs({
    buildTurns: mockBuildTurns,
    getPendingEmbeddings: mockPending,
    upsertTurnEmbeddings: mockUpsert,
    refreshSessionEmbeddings: mockRefresh,
    recordEmbeddingFailure: mockRecordFailure,
    withSemanticIndexLock: mockLock,
    getPendingErrors: mockPendingErrors,
    upsertErrorEmbeddings: mockUpsertErrors,
    recordErrorEmbeddingFailure: mockRecordErrorFailure,
  }),
);

const mockEmbed = mock((_texts: string[]) => Promise.resolve([[1], [2]] as number[][] | null));
mock.module("../../ai/embeddings", () => ({
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 1024,
  isEmbeddingAvailable: () => true,
  embedQuery: mock(() => Promise.resolve(null)),
  embedDocuments: mockEmbed,
  preparePromptText: (t: string) => `P:${t}`,
  prepareResponseText: (t: string) => `R:${t}`,
  prepareErrorText: (tool: string, msg: string) => `E:${tool}:${msg}`,
  contentHash: (t: string) => `hash(${t})`,
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const { indexOnce } = await import("../semanticIndexing");

beforeEach(() => {
  for (const m of [
    mockBuildTurns, mockPending, mockUpsert, mockRefresh, mockEmbed, mockRecordFailure,
    mockPendingErrors, mockUpsertErrors, mockRecordErrorFailure,
  ]) m.mockClear();
  mockPendingErrors.mockImplementation(() => Promise.resolve([]));
  lockAvailable = true;
  mockEmbed.mockImplementation(() => Promise.resolve([[1], [2]]));
});

describe("indexOnce", () => {
  test("builds turns, embeds pending texts by kind, refreshes sessions", async () => {
    let calls = 0;
    mockPending.mockImplementation(() => Promise.resolve(calls++ === 0 ? pending : []));
    const stats = await indexOnce({} as any);

    expect(stats).toEqual({
      turnsBuilt: 3,
      embedded: 2,
      errorsEmbedded: 0,
      rejected: 0,
      sessionsRefreshed: 1,
      embedderUnavailable: false,
      skippedLocked: false,
    });
    expect((mockEmbed.mock.calls[0] as any[])[0]).toEqual(["P:fix it", "R:done"]);
    const rows = (mockUpsert.mock.calls[0] as any[])[2];
    expect(rows).toEqual([
      { turn_id: "1", kind: "prompt", content_hash: "hash(P:fix it)", vector: "[1]" },
      { turn_id: "1", kind: "response", content_hash: "hash(R:done)", vector: "[2]" },
    ]);
  });

  test("stops without writing or blaming items when the embedder is down", async () => {
    mockPending.mockImplementation(() => Promise.resolve(pending));
    mockEmbed.mockImplementation(() => Promise.resolve(null));
    const stats = await indexOnce({} as any);

    expect(stats.embedderUnavailable).toBe(true);
    expect(stats.embedded).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
    // One batch attempt, then one retry per item.
    expect(mockEmbed).toHaveBeenCalledTimes(1 + pending.length);
  });

  test("isolates a poison text: records it, embeds the rest", async () => {
    let calls = 0;
    mockPending.mockImplementation(() => Promise.resolve(calls++ === 0 ? pending : []));
    mockEmbed.mockImplementation((texts: string[]) =>
      Promise.resolve(texts.length === 1 && texts[0] === "P:fix it" ? [[7]] : null),
    );
    const stats = await indexOnce({} as any);

    expect(stats.embedded).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.embedderUnavailable).toBe(false);
    expect((mockUpsert.mock.calls[0] as any[])[2]).toEqual([
      { turn_id: "1", kind: "prompt", content_hash: "hash(P:fix it)", vector: "[7]" },
    ]);
    expect((mockRecordFailure.mock.calls[0] as any[])[2]).toMatchObject({ turn_id: "1", kind: "response" });
  });

  test("embeds pending tool errors after turns", async () => {
    let calls = 0;
    mockPendingErrors.mockImplementation(() =>
      Promise.resolve(calls++ === 0 ? [{ event_id: "ev1", tool: "Bash", message: "boom" }] : []),
    );
    mockEmbed.mockImplementation(() => Promise.resolve([[5]]));
    const stats = await indexOnce({} as any);

    expect(stats.errorsEmbedded).toBe(1);
    expect((mockEmbed.mock.calls[0] as any[])[0]).toEqual(["E:Bash:boom"]);
    expect((mockUpsertErrors.mock.calls[0] as any[])[2]).toEqual([
      { event_id: "ev1", content_hash: "hash(E:Bash:boom)", vector: "[5]" },
    ]);
  });

  test("records a poison error message by event id", async () => {
    let calls = 0;
    mockPendingErrors.mockImplementation(() =>
      Promise.resolve(
        calls++ === 0
          ? [{ event_id: "ok", tool: "Bash", message: "fine" }, { event_id: "bad", tool: "Bash", message: "poison" }]
          : [],
      ),
    );
    mockEmbed.mockImplementation((texts: string[]) =>
      Promise.resolve(texts.length === 1 && texts[0] === "E:Bash:fine" ? [[1]] : null),
    );
    const stats = await indexOnce({} as any);

    expect(stats.errorsEmbedded).toBe(1);
    expect(stats.rejected).toBe(1);
    expect((mockRecordErrorFailure.mock.calls[0] as any[])[2]).toBe("bad");
  });

  test("skips errors when the embedder is down for turns", async () => {
    mockPending.mockImplementation(() => Promise.resolve(pending));
    mockEmbed.mockImplementation(() => Promise.resolve(null));
    await indexOnce({} as any);
    expect(mockPendingErrors).not.toHaveBeenCalled();
  });

  test("does nothing when another process holds the index lock", async () => {
    lockAvailable = false;
    const stats = await indexOnce({} as any);
    expect(stats.skippedLocked).toBe(true);
    expect(mockBuildTurns).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  test("respects the batch budget", async () => {
    mockPending.mockImplementation(() => Promise.resolve(pending));
    await indexOnce({} as any, { maxBatches: 3 });
    expect(mockEmbed).toHaveBeenCalledTimes(3);
  });
});
