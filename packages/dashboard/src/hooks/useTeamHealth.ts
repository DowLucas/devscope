import { useEffect, useState } from "react";
import type { TeamHealthData } from "@devscope/shared";
import { apiFetch } from "@/lib/api";

export function useTeamHealth() {
  const [data, setData] = useState<TeamHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    function fetchHealth() {
      apiFetch("/api/insights/team-health")
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
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { data, loading };
}
