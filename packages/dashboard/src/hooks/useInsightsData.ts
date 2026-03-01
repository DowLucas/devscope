import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export function useInsightsData<T>(
  endpoint: string,
  developerId?: string,
  days?: number
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (developerId) params.set("developerId", developerId);
    if (days) params.set("days", String(days));

    const qs = params.toString();
    const url = `/api/insights/${endpoint}${qs ? `?${qs}` : ""}`;

    apiFetch(url)
      .then((r) => r.json())
      .then((d) => {
        setData(d as T);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [endpoint, developerId, days]);

  return { data, loading };
}
