import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/** GET /api/commands/<endpoint> with query params; refetches when they change. */
export function useCommandsData<T>(
  endpoint: "summary" | "trend" | "projects",
  params: Record<string, string | number | null | undefined>,
  enabled = true,
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `/api/commands/${endpoint}?${qs.toString()}`;
  const [data, setData] = useState<T | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setData(d as T | null);
        setLoadedUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null); // never show the previous filter's results as this one's
        setLoadedUrl(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return { data: loadedUrl === url ? data : null, loading: enabled && loadedUrl !== url };
}
