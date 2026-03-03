import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mocks -- must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetStaleActiveSessions = mock(() => Promise.resolve([] as any[]));
const mockEndSession = mock(() => Promise.resolve());
const mockBroadcast = mock(() => {});

mock.module("../../db", () => ({
  getStaleActiveSessions: mockGetStaleActiveSessions,
  endSession: mockEndSession,
}));

mock.module("../../ws/handler", () => ({
  broadcast: mockBroadcast,
}));

// Import AFTER mocks are registered
const { startStaleSessionCleanup } = await import("../cleanupStaleSessions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const g = globalThis as any;

/** Small delay to let the async IIFE in startup cleanup complete. */
function wait(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a fake sql tagged-template (not actually called by the module). */
function makeMockSql() {
  return mock(() => Promise.resolve([])) as any;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset singleton guards so every test starts fresh
  g.__gc_cleanup_startup_done = false;
  if (g.__gc_cleanup_interval) {
    clearInterval(g.__gc_cleanup_interval);
    g.__gc_cleanup_interval = undefined;
  }

  // Reset all mock call history
  mockGetStaleActiveSessions.mockReset();
  mockGetStaleActiveSessions.mockImplementation(() => Promise.resolve([]));
  mockEndSession.mockReset();
  mockEndSession.mockImplementation(() => Promise.resolve());
  mockBroadcast.mockReset();

  // Reset env var to default
  delete process.env.STALE_SESSION_TIMEOUT_MINUTES;
});

afterEach(() => {
  // Clean up any intervals to prevent test leaks
  if (g.__gc_cleanup_interval) {
    clearInterval(g.__gc_cleanup_interval);
    g.__gc_cleanup_interval = undefined;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startStaleSessionCleanup", () => {
  // ---- Startup cleanup ----

  describe("startup cleanup", () => {
    test("runs startup cleanup on first call", async () => {
      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      await wait();

      expect(mockGetStaleActiveSessions).toHaveBeenCalledWith(sql, 1440);
    });

    test("sets the __gc_cleanup_startup_done flag after first call", () => {
      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      expect(g.__gc_cleanup_startup_done).toBe(true);
    });

    test("skips startup cleanup on second call", async () => {
      const sql = makeMockSql();

      // First call -- startup cleanup runs
      startStaleSessionCleanup(sql);
      await wait();

      const callCountAfterFirst = mockGetStaleActiveSessions.mock.calls.length;

      // Second call -- startup cleanup should be skipped
      startStaleSessionCleanup(sql);
      await wait();

      // getStaleActiveSessions should not have been called again for startup
      // (no additional call with the 1440-minute threshold)
      const startupCalls = mockGetStaleActiveSessions.mock.calls.filter(
        (call: any[]) => call[1] === 1440
      );
      expect(startupCalls.length).toBe(1);
    });

    test("ends each stale session found during startup", async () => {
      const staleSessions = [
        { id: "sess-1", developer_id: "dev-a", developer_name: "Alice" },
        { id: "sess-2", developer_id: "dev-b", developer_name: "Bob" },
      ];
      mockGetStaleActiveSessions.mockImplementation(() =>
        Promise.resolve(staleSessions)
      );

      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      await wait();

      expect(mockEndSession).toHaveBeenCalledTimes(2);
      expect(mockEndSession).toHaveBeenCalledWith(sql, "sess-1");
      expect(mockEndSession).toHaveBeenCalledWith(sql, "sess-2");
    });

    test("does not call endSession when no stale sessions at startup", async () => {
      mockGetStaleActiveSessions.mockImplementation(() => Promise.resolve([]));

      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      await wait();

      expect(mockEndSession).not.toHaveBeenCalled();
    });

    test("does not broadcast during startup cleanup", async () => {
      const staleSessions = [
        { id: "sess-1", developer_id: "dev-a", developer_name: "Alice" },
      ];
      mockGetStaleActiveSessions.mockImplementation(() =>
        Promise.resolve(staleSessions)
      );

      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      await wait();

      // Startup cleanup only calls endSession, no broadcast
      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    test("handles errors in startup cleanup gracefully", async () => {
      mockGetStaleActiveSessions.mockImplementation(() =>
        Promise.reject(new Error("DB connection failed"))
      );

      const sql = makeMockSql();

      // Should not throw
      startStaleSessionCleanup(sql);
      await wait();

      // The flag should still be set (it's set before the async call)
      expect(g.__gc_cleanup_startup_done).toBe(true);
    });
  });

  // ---- Interval setup ----

  describe("interval setup", () => {
    test("sets up an interval (stores it on globalThis)", () => {
      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      expect(g.__gc_cleanup_interval).toBeDefined();
    });

    test("clears previous interval on subsequent calls", () => {
      const sql = makeMockSql();

      startStaleSessionCleanup(sql);
      const firstInterval = g.__gc_cleanup_interval;

      startStaleSessionCleanup(sql);
      const secondInterval = g.__gc_cleanup_interval;

      // The intervals should be different (old one cleared, new one created)
      expect(secondInterval).not.toBe(firstInterval);
    });
  });

  // ---- Interval cleanup function (triggered by setInterval) ----

  describe("interval cleanup function", () => {
    test("ends stale sessions and broadcasts updates on interval tick", async () => {
      const staleSessions = [
        { id: "sess-10", developer_id: "dev-x", developer_name: "Xavier" },
        { id: "sess-11", developer_id: "dev-y", developer_name: "Yara" },
      ];

      const sql = makeMockSql();

      // First call sets up startup (returns empty) and interval
      startStaleSessionCleanup(sql);
      await wait();

      // Reset mocks after startup cleanup
      mockGetStaleActiveSessions.mockReset();
      mockEndSession.mockReset();
      mockBroadcast.mockReset();

      // Now configure mocks for interval tick
      mockGetStaleActiveSessions.mockImplementation(() =>
        Promise.resolve(staleSessions)
      );
      mockEndSession.mockImplementation(() => Promise.resolve());

      // Manually trigger the interval callback by getting the timer ID
      // and using Bun's timer internals -- instead, we'll just wait for
      // the real interval, but that's 60s. Instead, let's extract the
      // cleanup function by examining what setInterval was called with.
      // Since we can't easily do that, we'll use a different approach:
      // call startStaleSessionCleanup again (which re-creates the interval)
      // but we need a way to trigger it. Let's use fake timers instead.

      // Alternative: manually invoke the interval by clearing and retriggering
      // We'll store a reference and use a short interval approach.
      // Actually, the cleanest approach is to just test the interval indirectly
      // by capturing the callback.

      // Since direct interval testing is complex, let's just verify the
      // interval was set up. The actual cleanup logic is the same function
      // used by the interval. We can test it by triggering the interval.

      // Use the fact that the function creates a new interval each call.
      // We can monkey-patch setInterval to capture the callback.
      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      // Clear existing interval first
      if (g.__gc_cleanup_interval) {
        clearInterval(g.__gc_cleanup_interval);
        g.__gc_cleanup_interval = undefined;
      }
      g.__gc_cleanup_startup_done = true; // skip startup on this call

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        // Reset mocks again after the second startStaleSessionCleanup call
        mockGetStaleActiveSessions.mockReset();
        mockEndSession.mockReset();
        mockBroadcast.mockReset();

        mockGetStaleActiveSessions.mockImplementation(() =>
          Promise.resolve(staleSessions)
        );
        mockEndSession.mockImplementation(() => Promise.resolve());

        expect(capturedCallback).not.toBeNull();

        // Invoke the captured interval callback
        capturedCallback!();
        await wait();

        expect(mockGetStaleActiveSessions).toHaveBeenCalledTimes(1);
        expect(mockEndSession).toHaveBeenCalledTimes(2);
        expect(mockEndSession).toHaveBeenCalledWith(sql, "sess-10");
        expect(mockEndSession).toHaveBeenCalledWith(sql, "sess-11");

        // Should broadcast session.update for each session
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "session.update",
          data: { sessionId: "sess-10", status: "ended" },
        });
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "session.update",
          data: { sessionId: "sess-11", status: "ended" },
        });

        // Should broadcast developer.update for each unique developer
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "developer.update",
          data: { developerId: "dev-x" },
        });
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "developer.update",
          data: { developerId: "dev-y" },
        });

        // 2 session.update + 2 developer.update = 4 total broadcasts
        expect(mockBroadcast).toHaveBeenCalledTimes(4);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    test("deduplicates developer broadcasts when multiple sessions share a developer", async () => {
      const staleSessions = [
        { id: "sess-20", developer_id: "dev-same", developer_name: "Same Dev" },
        { id: "sess-21", developer_id: "dev-same", developer_name: "Same Dev" },
      ];

      const sql = makeMockSql();
      g.__gc_cleanup_startup_done = true; // skip startup

      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        mockGetStaleActiveSessions.mockReset();
        mockEndSession.mockReset();
        mockBroadcast.mockReset();

        mockGetStaleActiveSessions.mockImplementation(() =>
          Promise.resolve(staleSessions)
        );
        mockEndSession.mockImplementation(() => Promise.resolve());

        capturedCallback!();
        await wait();

        // 2 session.update broadcasts
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "session.update",
          data: { sessionId: "sess-20", status: "ended" },
        });
        expect(mockBroadcast).toHaveBeenCalledWith({
          type: "session.update",
          data: { sessionId: "sess-21", status: "ended" },
        });

        // Only 1 developer.update (deduplicated via Set)
        const developerUpdateCalls = mockBroadcast.mock.calls.filter(
          (call: any[]) => call[0]?.type === "developer.update"
        );
        expect(developerUpdateCalls.length).toBe(1);
        expect(developerUpdateCalls[0][0]).toEqual({
          type: "developer.update",
          data: { developerId: "dev-same" },
        });

        // Total: 2 session.update + 1 developer.update = 3
        expect(mockBroadcast).toHaveBeenCalledTimes(3);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    test("does not broadcast when no stale sessions found on interval", async () => {
      const sql = makeMockSql();
      g.__gc_cleanup_startup_done = true;

      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        mockGetStaleActiveSessions.mockReset();
        mockBroadcast.mockReset();

        mockGetStaleActiveSessions.mockImplementation(() => Promise.resolve([]));

        capturedCallback!();
        await wait();

        expect(mockBroadcast).not.toHaveBeenCalled();
        expect(mockEndSession).not.toHaveBeenCalled();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    test("handles errors in interval cleanup gracefully", async () => {
      const sql = makeMockSql();
      g.__gc_cleanup_startup_done = true;

      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        mockGetStaleActiveSessions.mockReset();

        mockGetStaleActiveSessions.mockImplementation(() =>
          Promise.reject(new Error("DB timeout"))
        );

        // Should not throw
        capturedCallback!();
        await wait();

        expect(mockBroadcast).not.toHaveBeenCalled();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });
  });

  // ---- Environment variable handling ----

  describe("environment variable handling", () => {
    test("defaults threshold to 5 minutes when env var is not set", async () => {
      delete process.env.STALE_SESSION_TIMEOUT_MINUTES;

      const sql = makeMockSql();
      g.__gc_cleanup_startup_done = true;

      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        mockGetStaleActiveSessions.mockReset();
        mockGetStaleActiveSessions.mockImplementation(() => Promise.resolve([]));

        capturedCallback!();
        await wait();

        // The interval cleanup should use the default threshold of 5
        expect(mockGetStaleActiveSessions).toHaveBeenCalledWith(sql, 5);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    test("uses custom threshold from STALE_SESSION_TIMEOUT_MINUTES env var", async () => {
      process.env.STALE_SESSION_TIMEOUT_MINUTES = "15";

      const sql = makeMockSql();
      g.__gc_cleanup_startup_done = true;

      const originalSetInterval = globalThis.setInterval;
      let capturedCallback: (() => void) | null = null;

      globalThis.setInterval = ((cb: () => void, ms: number) => {
        capturedCallback = cb;
        return originalSetInterval(cb, ms);
      }) as any;

      try {
        startStaleSessionCleanup(sql);

        mockGetStaleActiveSessions.mockReset();
        mockGetStaleActiveSessions.mockImplementation(() => Promise.resolve([]));

        capturedCallback!();
        await wait();

        expect(mockGetStaleActiveSessions).toHaveBeenCalledWith(sql, 15);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    test("startup cleanup always uses 1440-minute (24h) threshold regardless of env var", async () => {
      process.env.STALE_SESSION_TIMEOUT_MINUTES = "30";

      const sql = makeMockSql();
      startStaleSessionCleanup(sql);

      await wait();

      // Startup should use the fixed 1440-minute threshold
      expect(mockGetStaleActiveSessions).toHaveBeenCalledWith(sql, 1440);
    });
  });
});
