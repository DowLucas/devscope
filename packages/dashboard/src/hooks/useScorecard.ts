import { useEffect, useState } from "react";
import type { ExecutiveScorecard } from "@devscope/shared";
import { apiFetch } from "@/lib/api";

export function useScorecard(days = 7) {
  const [data, setData] = useState<ExecutiveScorecard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/reports/scorecard?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [days]);

  return { data, loading };
}
