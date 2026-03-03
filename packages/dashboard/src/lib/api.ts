export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "devscope-dashboard");
  return fetch(url, { ...init, headers, credentials: "include" });
}
