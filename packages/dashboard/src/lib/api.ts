const API_KEY = import.meta.env.VITE_GC_API_KEY;

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (API_KEY) headers.set("Authorization", `Bearer ${API_KEY}`);
  return fetch(url, { ...init, headers });
}

export function wsUrl(base: string): string {
  if (API_KEY) {
    const sep = base.includes("?") ? "&" : "?";
    return base + sep + "token=" + encodeURIComponent(API_KEY);
  }
  return base;
}
