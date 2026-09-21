import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { CoachingCard, type CoachingCardData } from "./CoachingCard";

export function CoachingPage() {
  const [latest, setLatest] = useState<CoachingCardData | null | undefined>(undefined);
  const [history, setHistory] = useState<CoachingCardData[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/api/coaching/me").then((r) => r.json()),
      apiFetch("/api/coaching/me/history?limit=8").then((r) => r.json()),
    ])
      .then(([meRes, histRes]) => {
        if (cancelled) return;
        setLatest(meRes?.card ?? null);
        setHistory(
          Array.isArray(histRes?.cards) ? histRes.cards.slice(1) : [],
        );
      })
      .catch(() => {
        if (!cancelled) setLatest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const markViewed = useCallback(
    async (cardId: string) => {
      try {
        await apiFetch("/api/coaching/me/viewed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_id: cardId }),
        });
        refresh();
      } catch {
        // ignore
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="My coaching"
        description="Weekly recommendations based on your own Claude Code sessions. Visible only to you."
      />

      {latest === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : latest === null ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No coaching card yet. Cards are generated weekly on Monday mornings, once you have at
            least 3 sessions in the past 7 days.
          </p>
        </div>
      ) : (
        <CoachingCard card={latest} onMarkViewed={markViewed} />
      )}

      {history.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Earlier weeks</h2>
          <div className="space-y-3">
            {history.map((card) => (
              <CoachingCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
