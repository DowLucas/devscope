import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export function useInsightsData<T>(
  endpoint: string,
  developerId?: string,
  days?: number
) {
  const [data, setData] = useState<T | null>(null);
  const fetchKey = `${endpoint}:${developerId ?? ""}:${days ?? ""}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    const key = fetchKey;
    const params = new URLSearchParams();
    if (developerId) params.set("developerId", developerId);
    if (days) params.set("days", String(days));

    const qs = params.toString();
    const url = `/api/insights/${endpoint}${qs ? `?${qs}` : ""}`;

    apiFetch(url)
      .then((r) => r.json())
      .then((d) => {
        setData(d as T);
        setLoadedKey(key);
      })
      .catch(() => setLoadedKey(key));
  }, [endpoint, developerId, days, fetchKey]);

  return { data, loading };
}
